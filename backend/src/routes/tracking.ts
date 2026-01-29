import express, { Response, Request } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticate, AuthRequest } from '../middleware/auth';
import {
  createTrackingNumber,
  getAllTrackingNumbers,
  getTrackingNumbersByBox,
  getTrackingNumberById,
  updateTrackingStatus,
  deleteTrackingNumber,
  bulkCreateTrackingNumbers,
  deleteAllTrackingNumbers,
  bulkDeleteTrackingNumbers,
  updateTrackingNumberBox,
  getTrackingEvents,
  saveTrackingEvents,
} from '../models/tracking';
import { createBox, getAllBoxes, getBoxById, updateBox, deleteBox, getKingBoxes } from '../models/box';
import { getStatusHistory, getRecentStatusChanges, getRecentScannedChanges } from '../models/statusHistory';
import { updateAllTrackingStatuses, cleanupOldTrackingData } from '../services/scheduler';
import { checkInPostStatus } from '../services/scraper';
import { pool } from '../db/connection';
import { verifyToken } from '../services/auth';

const router = express.Router();

// SSE routes must be defined BEFORE authenticate middleware
// because EventSource can't send custom headers, so we use query parameter
// Test endpoint to verify SSE route is accessible
router.get('/logs/stream/test', async (req: Request, res: Response) => {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token as string;
  
  if (!token) {
    return res.status(401).json({ error: 'Token required' });
  }
  
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  res.json({ 
    message: 'SSE endpoint is accessible',
    timestamp: new Date().toISOString(),
    user: payload.email
  });
});

// Handle OPTIONS for SSE endpoint (CORS preflight)
router.options('/logs/stream', (req: Request, res: Response) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
  res.status(204).end();
});

// SSE endpoint for real-time log updates
// Note: EventSource doesn't support custom headers, so we accept token as query param
router.get('/logs/stream', async (req: Request, res: Response) => {
  console.log('=== SSE CONNECTION ATTEMPT ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Path:', req.path);
  console.log('Origin:', req.headers.origin);
  console.log('User-Agent:', req.headers['user-agent']);
  console.log('Query params:', Object.keys(req.query));
  console.log('Has token in query:', !!req.query.token);
  
  // Get token from query parameter (EventSource limitation)
  const token = req.query.token as string;
  
  if (!token) {
    console.error('SSE connection rejected: No token provided');
    return res.status(401).json({ error: 'Token required' });
  }
  
  // Verify token manually
  const payload = verifyToken(token);
  
  if (!payload) {
    console.error('SSE connection rejected: Invalid token');
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  console.log('SSE connection accepted for user:', payload.email);
  
  // Set headers for SSE - MUST be set before any writes
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  
  // CORS headers for SSE (must be set before any writes)
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
  
  // Set 200 status explicitly
  res.status(200);
  
  // CRITICAL FIX: Reverse proxies buffer small responses
  // We need to send enough data (>4KB typically) to force immediate flush
  // Send large padding using SSE comment lines (comments start with :)
  const paddingSize = 4096; // 4KB to force proxy flush
  const padding = ': ' + 'x'.repeat(paddingSize) + '\n';
  res.write(padding);
  
  // Send connection establishment messages
  res.write(': SSE connection established\n');
  res.write(': Server ready, sending initial data\n\n');
  
  // Send initial connection message
  // Use proper SSE format: data: followed by JSON, then double newline
  const initialData = { type: 'connected', message: 'Stream connected', timestamp: new Date().toISOString() };
  res.write(`data: ${JSON.stringify(initialData)}\n\n`);
  
  // Send another small keepalive to ensure delivery
  res.write(': connection confirmed\n\n');
  
  console.log('SSE initial messages sent (with 4KB buffer-busting padding)');
  console.log('Initial data:', initialData);
  
  // Try to force flush using the underlying socket
  const nodeRes = res as any;
  if (nodeRes.socket && typeof nodeRes.socket.flush === 'function') {
    try {
      nodeRes.socket.flush();
      console.log('Socket flushed');
    } catch (e) {
      // Ignore flush errors
    }
  }
  
  let lastCheck = new Date(Date.now() - 60000); // Start from 1 minute ago
  let heartbeatCount = 0;
  let isConnectionOpen = true;
  
  // Send heartbeat more frequently initially to keep connection alive
  const sendHeartbeat = () => {
    if (!isConnectionOpen) return;
    try {
      res.write(`data: ${JSON.stringify({ 
        type: 'heartbeat', 
        timestamp: new Date().toISOString() 
      })}\n\n`);
      const nodeRes = res as any;
      if (typeof nodeRes.flush === 'function') {
        nodeRes.flush();
      }
    } catch (error) {
      console.error('Error sending heartbeat:', error);
      isConnectionOpen = false;
    }
  };
  
  // Send heartbeat every 10 seconds to keep connection alive
  const heartbeatInterval = setInterval(sendHeartbeat, 10000);
  
  const checkInterval = setInterval(async () => {
    if (!isConnectionOpen) {
      clearInterval(checkInterval);
      clearInterval(heartbeatInterval);
      return;
    }
    
    try {
      // Get new logs since last check
      const newLogs = await pool.query(
        `WITH status_changes AS (
          SELECT
            sh.id,
            t.tracking_number,
            lag(sh.status) OVER (PARTITION BY sh.tracking_number_id ORDER BY sh.timestamp) as old_status,
            sh.status as new_status,
            t.status_details,
            b.name as box_name,
            b.id as box_id,
            sh.timestamp as changed_at,
            CASE
              WHEN lag(sh.status) OVER (PARTITION BY sh.tracking_number_id ORDER BY sh.timestamp) != sh.status THEN 'status_change'
              ELSE 'details_update'
            END as change_type
          FROM status_history sh
          JOIN tracking_numbers t ON sh.tracking_number_id = t.id
          LEFT JOIN boxes b ON t.box_id = b.id
          WHERE sh.timestamp > $1
        )
        SELECT * FROM status_changes
        ORDER BY changed_at DESC
        LIMIT 50`,
        [lastCheck]
      );
      
      if (newLogs.rows.length > 0 && isConnectionOpen) {
        // Send new logs to client
        res.write(`data: ${JSON.stringify({ 
          type: 'logs', 
          logs: newLogs.rows,
          timestamp: new Date().toISOString()
        })}\n\n`);
        
        const nodeRes = res as any;
        if (typeof nodeRes.flush === 'function') {
          nodeRes.flush();
        }
        
        // Update last check time to the most recent log
        lastCheck = newLogs.rows[0].changed_at;
      }
    } catch (error) {
      console.error('Error in SSE stream:', error);
      if (isConnectionOpen) {
        try {
          res.write(`data: ${JSON.stringify({ 
            type: 'error', 
            message: 'Stream error',
            error: error instanceof Error ? error.message : 'Unknown error'
          })}\n\n`);
          const nodeRes = res as any;
          if (typeof nodeRes.flush === 'function') {
            nodeRes.flush();
          }
        } catch (writeError) {
          console.error('Error writing error message:', writeError);
          isConnectionOpen = false;
        }
      }
    }
  }, 2000); // Check every 2 seconds
  
  // Clean up on client disconnect
  const cleanup = () => {
    if (!isConnectionOpen) return; // Already cleaned up
    isConnectionOpen = false;
    clearInterval(checkInterval);
    clearInterval(heartbeatInterval);
    console.log('SSE connection cleaned up for user:', payload.email);
    try {
      res.end();
    } catch (error) {
      // Connection might already be closed
    }
  };
  
  req.on('close', () => {
    console.log('SSE client disconnected (req.close) for user:', payload.email);
    cleanup();
  });
  
  // Also handle errors
  req.on('error', (error) => {
    console.error('SSE request error:', error);
    cleanup();
  });
  
  // Handle response errors
  res.on('error', (error) => {
    console.error('SSE response error:', error);
    cleanup();
  });
  
  // Handle response finish
  res.on('finish', () => {
    console.log('SSE response finished for user:', payload.email);
    cleanup();
  });
});

// All other routes require authentication
router.use(authenticate);

// Boxes endpoints
router.get('/boxes', async (req: AuthRequest, res: Response) => {
  try {
    const kingBoxId = req.query.kingBoxId ? parseInt(req.query.kingBoxId as string) : undefined;
    const boxes = await getAllBoxes(kingBoxId || null);
    res.json(boxes);
  } catch (error) {
    console.error('Error fetching boxes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get king boxes only
router.get('/boxes/king', async (req: AuthRequest, res: Response) => {
  try {
    const kingBoxes = await getKingBoxes();
    res.json(kingBoxes);
  } catch (error) {
    console.error('Error fetching king boxes:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post(
  '/boxes',
  [
    body('name').notEmpty().trim(),
    body('parent_box_id').optional({ nullable: true, checkFalsy: true }).custom((value) => {
      if (value === undefined || value === null) return true;
      const num = Number(value);
      if (isNaN(num) || !Number.isInteger(num)) {
        throw new Error('parent_box_id must be an integer');
      }
      return true;
    }),
    body('is_king_box').optional().custom((value) => {
      if (value === undefined || value === null) return true;
      if (typeof value === 'boolean') return true;
      if (typeof value === 'string' && (value === 'true' || value === 'false')) return true;
      throw new Error('is_king_box must be a boolean');
    }),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('Validation errors:', JSON.stringify(errors.array(), null, 2));
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    try {
      const { name, parent_box_id, is_king_box } = req.body;
      
      // Convert is_king_box to boolean if it's a string
      let isKingBox = false;
      if (is_king_box !== undefined && is_king_box !== null) {
        if (typeof is_king_box === 'string') {
          isKingBox = is_king_box === 'true';
        } else {
          isKingBox = Boolean(is_king_box);
        }
      }
      
      // Validate parent box exists if provided
      if (parent_box_id !== undefined && parent_box_id !== null) {
        const parentBox = await getBoxById(parent_box_id);
        if (!parentBox) {
          return res.status(404).json({ error: 'Parent box not found' });
        }
        if (!parentBox.is_king_box) {
          return res.status(400).json({ error: 'Parent box must be a king box' });
        }
      }
      
      const box = await createBox(name, parent_box_id || null, isKingBox);
      res.status(201).json(box);
    } catch (error: any) {
      console.error('Error creating box:', error);
      console.error('Error details:', error.message, error.stack);
      res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  }
);

router.patch(
  '/boxes/:id',
  [
    body('name').notEmpty().trim(),
    body('parent_box_id').optional({ nullable: true }).isInt(),
    body('is_king_box').optional().isBoolean(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const { name, parent_box_id, is_king_box } = req.body;
      
      // Validate parent box exists if provided
      if (parent_box_id !== undefined && parent_box_id !== null) {
        const parentBox = await getBoxById(parent_box_id);
        if (!parentBox) {
          return res.status(404).json({ error: 'Parent box not found' });
        }
        if (!parentBox.is_king_box) {
          return res.status(400).json({ error: 'Parent box must be a king box' });
        }
      }
      
      const box = await updateBox(
        Number(id),
        name,
        parent_box_id !== undefined ? parent_box_id : undefined,
        is_king_box !== undefined ? is_king_box : undefined
      );
      if (!box) {
        return res.status(404).json({ error: 'Box not found' });
      }
      res.json(box);
    } catch (error) {
      console.error('Error updating box:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.delete('/boxes/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const deleted = await deleteBox(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Box not found' });
    }
    res.json({ message: 'Box deleted successfully' });
  } catch (error) {
    console.error('Error deleting box:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Tracking numbers endpoints
router.get('/numbers', async (req: AuthRequest, res: Response) => {
  try {
    const boxId = req.query.boxId ? parseInt(req.query.boxId as string) : undefined;
    const page = req.query.page ? parseInt(req.query.page as string) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const status = req.query.status as 'not_scanned' | 'scanned' | 'delivered' | undefined;
    const customTimestamp = req.query.customTimestamp as string | undefined;
    const search = req.query.search as string | undefined;
    const trackingNumberSearch = req.query.trackingNumber as string | undefined;
    const unassignedOnly = req.query.unassignedOnly === 'true';
    const kingBoxId = req.query.kingBoxId ? parseInt(req.query.kingBoxId as string) : undefined;
    
    // Validate status if provided
    if (status && !['not_scanned', 'scanned', 'delivered'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status filter' });
    }
    
    // Validate customTimestamp format if provided (should be YYYY-MM-DD)
    if (customTimestamp && !/^\d{4}-\d{2}-\d{2}$/.test(customTimestamp)) {
      return res.status(400).json({ error: 'Invalid customTimestamp format. Expected YYYY-MM-DD' });
    }
    
    // If boxId is specified, use getTrackingNumbersByBox (takes precedence)
    // Otherwise, use getAllTrackingNumbers with optional kingBoxId filter
    const result = boxId
      ? await getTrackingNumbersByBox(boxId, page, limit, status, customTimestamp, search || trackingNumberSearch)
      : await getAllTrackingNumbers(page, limit, status, customTimestamp, search || trackingNumberSearch, unassignedOnly, kingBoxId || null);
    res.json(result);
  } catch (error) {
    console.error('Error fetching tracking numbers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get not scanned tracking numbers by date
// IMPORTANT: This route must be defined BEFORE /numbers/:id to avoid route conflicts
router.get('/numbers/not-scanned-by-date', async (req: AuthRequest, res: Response) => {
  try {
    const date = req.query.date as string;
    
    if (!date) {
      return res.status(400).json({ error: 'Date parameter is required (YYYY-MM-DD format)' });
    }
    
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD' });
    }
    
    // Query tracking numbers with not_scanned status for the given date
    // Use DATE() function to match the date part, similar to first-scans endpoint
    const result = await pool.query(`
      SELECT 
        t.*,
        b.name as box_name
      FROM tracking_numbers t
      LEFT JOIN boxes b ON t.box_id = b.id
      WHERE DATE(t.created_at) = $1::DATE
        AND t.current_status = 'not_scanned'
      ORDER BY t.created_at DESC
    `, [date]);
    
    res.json(result.rows);
  } catch (error: any) {
    console.error('Error fetching not scanned items by date:', error);
    console.error('Error details:', error.message, error.stack);
    res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/numbers/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const trackingNumber = await getTrackingNumberById(id);
    if (!trackingNumber) {
      return res.status(404).json({ error: 'Tracking number not found' });
    }
    
    const history = await getStatusHistory(id);
    res.json({ ...trackingNumber, history });
  } catch (error) {
    console.error('Error fetching tracking number:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get tracking events timeline for a tracking number
router.get('/numbers/:id/events', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }
    
    const events = await getTrackingEvents(id);
    res.json(events);
  } catch (error) {
    console.error('Error fetching tracking events:', error);
    res.status(500).json({ error: 'Failed to fetch tracking events' });
  }
});

router.post(
  '/numbers',
  [
    body('tracking_number').notEmpty().trim(),
    body('box_id').optional().isInt(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { tracking_number, box_id } = req.body;
      
      // Validate box exists if provided
      if (box_id) {
        const box = await getBoxById(box_id);
        if (!box) {
          return res.status(404).json({ error: 'Box not found' });
        }
      }
      
      const tracking = await createTrackingNumber(tracking_number, box_id || null);
      res.status(201).json(tracking);
    } catch (error) {
      console.error('Error creating tracking number:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.post(
  '/numbers/bulk',
  [
    body('tracking_numbers').isArray().notEmpty(),
    body('tracking_numbers.*').isString().trim().notEmpty(),
    body('box_id').optional().isInt(),
    body('custom_timestamp')
      .optional({ nullable: true, checkFalsy: true })
      .custom((value) => {
        // If value is null, undefined, or empty string, it's valid
        if (value === null || value === undefined || value === '') {
          return true;
        }
        // Otherwise, it must be a valid ISO8601 date
        const date = new Date(value);
        if (isNaN(date.getTime())) {
          throw new Error('custom_timestamp must be a valid ISO8601 date string');
        }
        return true;
      })
      .toDate(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { tracking_numbers, box_id, custom_timestamp } = req.body;
      
      console.log('Bulk import request:', {
        tracking_numbers_count: tracking_numbers?.length,
        box_id,
        custom_timestamp,
        custom_timestamp_type: typeof custom_timestamp
      });
      
      // Validate box exists if provided
      if (box_id) {
        const box = await getBoxById(box_id);
        if (!box) {
          return res.status(404).json({ error: 'Box not found' });
        }
      }
      
      const created = await bulkCreateTrackingNumbers(
        tracking_numbers, 
        box_id || null,
        custom_timestamp || null
      );
      
      console.log('Bulk import result:', {
        created_count: created.length,
        first_item_custom_timestamp: created[0]?.custom_timestamp
      });
      res.status(201).json({ 
        message: `Created ${created.length} tracking numbers`,
        tracking_numbers: created 
      });
    } catch (error) {
      console.error('Error bulk creating tracking numbers:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.delete('/numbers/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const deleted = await deleteTrackingNumber(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Tracking number not found' });
    }
    res.json({ message: 'Tracking number deleted successfully' });
  } catch (error) {
    console.error('Error deleting tracking number:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk delete tracking numbers
router.post(
  '/numbers/bulk/delete',
  [
    body('ids').isArray().notEmpty(),
    body('ids.*').isInt(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { ids } = req.body;
      const deletedCount = await bulkDeleteTrackingNumbers(ids);
      res.json({ 
        message: `Successfully deleted ${deletedCount} tracking number(s)`,
        deletedCount 
      });
    } catch (error) {
      console.error('Error bulk deleting tracking numbers:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Delete all tracking numbers
router.delete('/numbers', async (req: AuthRequest, res: Response) => {
  try {
    const deletedCount = await deleteAllTrackingNumbers();
    res.json({ 
      message: `Successfully deleted ${deletedCount} tracking number(s)`,
      deletedCount 
    });
  } catch (error) {
    console.error('Error deleting all tracking numbers:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update box for existing tracking number
router.patch(
  '/numbers/:id/box',
  [body('box_id').optional({ nullable: true }).isInt()],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const { box_id } = req.body;
      
      // Validate box exists if provided
      if (box_id) {
        const box = await getBoxById(box_id);
        if (!box) {
          return res.status(404).json({ error: 'Box not found' });
        }
      }
      
      const tracking = await getTrackingNumberById(Number(id));
      if (!tracking) {
        return res.status(404).json({ error: 'Tracking number not found' });
      }

      const updated = await updateTrackingNumberBox(Number(id), box_id || null);
      res.json(updated);
    } catch (error) {
      console.error('Error updating tracking number box:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Manual refresh endpoint for a single tracking number
router.post('/numbers/:id/refresh', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id);
    const tracking = await getTrackingNumberById(id);
    
    if (!tracking) {
      return res.status(404).json({ error: 'Tracking number not found' });
    }

    // Skip if manually set
    if (tracking.is_manual_status) {
      return res.status(400).json({ 
        error: 'Cannot refresh: Status is manually set. Clear manual flag first or update status manually.' 
      });
    }

    console.log(`Manual refresh requested for ${tracking.tracking_number}`);
    
    const result = await checkInPostStatus(tracking.tracking_number);
    
    // Update status if changed (isManual=false for refresh)
    if (result.status !== tracking.current_status || result.statusHeader !== tracking.status_details) {
      await updateTrackingStatus(tracking.id, result.status, result.statusHeader, undefined, false, result.trackingmoreStatus, result.itemReceived);
      console.log(`Manual refresh updated ${tracking.tracking_number}: ${tracking.current_status} -> ${result.status}`);
    }
    
    // Save tracking events if available
    if (result.events && result.events.length > 0) {
      await saveTrackingEvents(tracking.id, result.events);
      console.log(`Saved ${result.events.length} events for ${tracking.tracking_number}`);
    }
    
    // Get updated tracking
    const updated = await getTrackingNumberById(id);
    res.json({ 
      message: 'Tracking status refreshed',
      tracking: updated,
      status: result.status,
      statusHeader: result.statusHeader
    });
  } catch (error) {
    console.error('Error in manual refresh:', error);
    res.status(500).json({ error: 'Failed to refresh tracking status' });
  }
});

// Manual refresh endpoint - trigger status update for all tracking numbers
router.post('/refresh', async (req: AuthRequest, res: Response) => {
  try {
    // Start the update process (non-blocking)
    updateAllTrackingStatuses().catch((error) => {
      console.error('Error in manual refresh:', error);
    });
    
    res.json({ 
      message: 'Tracking status refresh started. Check logs for progress.',
      note: 'This may take a few minutes depending on the number of tracking numbers.'
    });
  } catch (error) {
    console.error('Error starting manual refresh:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Manual cleanup endpoint - trigger cleanup of old tracking data (for testing)
router.post('/cleanup', async (req: AuthRequest, res: Response) => {
  try {
    // Start the cleanup process (non-blocking)
    cleanupOldTrackingData().catch((error) => {
      console.error('Error in manual cleanup:', error);
    });
    
    res.json({ 
      message: 'Cleanup started. Check logs for progress.',
      note: 'This will delete tracking data older than 5 weeks. Check backend logs to see what was deleted.'
    });
  } catch (error) {
    console.error('Error starting manual cleanup:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Manual status update endpoint - update a single tracking number's status
router.patch(
  '/numbers/:id/status',
  [
    body('status').isIn(['not_scanned', 'scanned', 'delivered']),
    body('custom_timestamp').optional({ nullable: true, checkFalsy: true }).isISO8601().toDate(),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('Validation errors:', JSON.stringify(errors.array(), null, 2));
      console.error('Request body:', JSON.stringify(req.body, null, 2));
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { id } = req.params;
      const { status, custom_timestamp } = req.body;
      
      console.log(`Updating tracking ${id}: status=${status}, custom_timestamp=${custom_timestamp}`);
      
      const tracking = await getTrackingNumberById(Number(id));
      if (!tracking) {
        return res.status(404).json({ error: 'Tracking number not found' });
      }

      // Set isManual=true when manually updating status
      await updateTrackingStatus(
        Number(id), 
        status, 
        undefined, 
        custom_timestamp || null,
        true  // isManual = true
      );
      
      // Get updated tracking with joins (use large limit to get all, then find the one we need)
      const allTracking = await getAllTrackingNumbers(1, 10000);
      const updated = allTracking.data.find(t => t.id === Number(id));
      
      res.json(updated);
    } catch (error) {
      console.error('Error updating tracking status:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Users (Link Telegram from dashboard) — protected by router.use(authenticate) above
router.get('/users', async (req: AuthRequest, res: Response) => {
  try {
    const users = await getAllUsers();
    res.json(users);
  } catch (error) {
    console.error('Error listing users:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch(
  '/users/:id/telegram',
  [
    body('telegram_username').optional({ nullable: true }).trim(),
    body('telegram_user_id').optional({ nullable: true }),
  ],
  async (req: AuthRequest, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    try {
      const userId = parseInt(req.params.id, 10);
      if (isNaN(userId)) {
        return res.status(400).json({ error: 'Invalid user ID' });
      }
      const user = await getUserById(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      const { telegram_username, telegram_user_id } = req.body;
      const updated = await updateUserTelegramIdentity(
        userId,
        telegram_username ?? null,
        telegram_user_id ?? null
      );
      if (!updated) {
        return res.status(500).json({ error: 'Failed to update user Telegram identity' });
      }
      const updatedUser = await getUserById(userId);
      res.json(updatedUser);
    } catch (error) {
      console.error('Error updating user Telegram identity:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Fetch Telegram username from Telegram API using user's telegram_user_id (getChatMember).
// Only works if the user has started the bot (private chat exists). Optionally saves to user.
router.post('/users/:id/fetch-telegram-username', async (req: AuthRequest, res: Response) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const telegramUserId = user.telegram_user_id;
    if (telegramUserId == null || String(telegramUserId).trim() === '') {
      return res.status(400).json({ error: 'User has no Telegram user ID set' });
    }
    const username = await getTelegramUsernameByUserId(telegramUserId);
    if (username != null) {
      await updateUserTelegramIdentity(userId, username, telegramUserId);
    }
    const updatedUser = await getUserById(userId);
    // Return only the fetched username (no DB fallback) so the frontend can distinguish
    // fetch success (username set) from fetch failure (username null → show error, don't reload).
    return res.json({
      username: username ?? null,
      user: updatedUser,
    });
  } catch (error) {
    console.error('Error fetching Telegram username:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logs endpoints
router.get('/logs/status-changes', async (req: AuthRequest, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const changeType = req.query.changeType as 'status_change' | 'details_update' | undefined;
    const status = req.query.status as 'not_scanned' | 'scanned' | 'delivered' | undefined;
    const boxId = req.query.boxId ? parseInt(req.query.boxId as string) : undefined;
    const trackingNumber = req.query.trackingNumber as string | undefined;
    
    const logs = await getRecentStatusChanges(
      Math.min(limit, 200), // Max 200 entries
      changeType,
      status,
      boxId,
      trackingNumber
    );
    res.json(logs);
  } catch (error) {
    console.error('Error fetching status change logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get date-based stats for IDs added today, yesterday, 2 days ago, and 3 days ago
router.get('/logs/first-scans', async (req: AuthRequest, res: Response) => {
  try {
    // Get counts grouped by date (today, yesterday, 2 days ago, 3 days ago) and status
    const result = await pool.query(`
      WITH date_groups AS (
        SELECT 
          DATE(t.created_at) as created_date,
          t.current_status,
          COUNT(*) as count
        FROM tracking_numbers t
        WHERE DATE(t.created_at) >= CURRENT_DATE - INTERVAL '3 days'
        GROUP BY DATE(t.created_at), t.current_status
      )
      SELECT 
        created_date,
        current_status,
        count
      FROM date_groups
      ORDER BY created_date DESC, current_status
    `);

    // Initialize default structure
    const stats = {
      today: { not_scanned: 0, scanned: 0, delivered: 0, total: 0 },
      yesterday: { not_scanned: 0, scanned: 0, delivered: 0, total: 0 },
      twoDaysAgo: { not_scanned: 0, scanned: 0, delivered: 0, total: 0 },
      threeDaysAgo: { not_scanned: 0, scanned: 0, delivered: 0, total: 0 }
    };

    // Get date strings in YYYY-MM-DD format for comparison
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const yesterdayDate = new Date(now);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = yesterdayDate.toISOString().split('T')[0];
    const twoDaysAgoDate = new Date(now);
    twoDaysAgoDate.setDate(twoDaysAgoDate.getDate() - 2);
    const twoDaysAgoStr = twoDaysAgoDate.toISOString().split('T')[0];
    const threeDaysAgoDate = new Date(now);
    threeDaysAgoDate.setDate(threeDaysAgoDate.getDate() - 3);
    const threeDaysAgoStr = threeDaysAgoDate.toISOString().split('T')[0];

    // Process results
    result.rows.forEach((row: any) => {
      // Convert PostgreSQL date to YYYY-MM-DD string
      const rowDateStr = row.created_date instanceof Date 
        ? row.created_date.toISOString().split('T')[0]
        : String(row.created_date).split('T')[0];
      
      let target: 'today' | 'yesterday' | 'twoDaysAgo' | 'threeDaysAgo' | null = null;
      if (rowDateStr === todayStr) {
        target = 'today';
      } else if (rowDateStr === yesterdayStr) {
        target = 'yesterday';
      } else if (rowDateStr === twoDaysAgoStr) {
        target = 'twoDaysAgo';
      } else if (rowDateStr === threeDaysAgoStr) {
        target = 'threeDaysAgo';
      }

      if (target) {
        const status = row.current_status as 'not_scanned' | 'scanned' | 'delivered';
        const count = parseInt(row.count);
        stats[target][status] = count;
        stats[target].total += count;
      }
    });

    res.json(stats);
  } catch (error) {
    console.error('Error fetching date-based stats:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/logs/scanned-changes', async (req: AuthRequest, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const logs = await getRecentScannedChanges(Math.min(limit, 50)); // Max 50 entries
    res.json(logs);
  } catch (error) {
    console.error('Error fetching scanned change logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get cleanup logs
router.get('/cleanup-logs', async (req: AuthRequest, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const result = await pool.query(
      'SELECT * FROM cleanup_logs ORDER BY created_at DESC LIMIT $1',
      [Math.min(limit, 100)]
    );
    console.log(`[Cleanup Logs API] Returning ${result.rows.length} cleanup log(s)`);
    if (result.rows.length > 0) {
      console.log(`[Cleanup Logs API] Sample log:`, JSON.stringify(result.rows[0], null, 2));
    }
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching cleanup logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
