import express from 'express';
import { authenticate } from '../middleware/auth';
import { pool } from '../db/connection';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get analytics for all boxes
router.get('/boxes', async (req, res) => {
  try {
    const filterType = req.query.filter as string | undefined; // 'all', 'individual', 'king'
    
    // Build WHERE clause for boxes based on filter
    let boxWhereClause = '';
    if (filterType === 'king') {
      boxWhereClause = 'WHERE b.is_king_box = true';
    }
    
    const result = await pool.query(`
      SELECT 
        b.id,
        b.name,
        b.created_at,
        b.parent_box_id,
        b.is_king_box,
        MIN(t.created_at) as sent_out_date,
        COUNT(t.id) as total_items,
        COUNT(CASE WHEN t.current_status = 'not_scanned' THEN 1 END) as not_scanned_count,
        COUNT(CASE WHEN t.current_status = 'scanned' THEN 1 END) as scanned_count,
        COUNT(CASE WHEN t.current_status = 'delivered' THEN 1 END) as delivered_count,
        COUNT(CASE 
          WHEN t.current_status = 'scanned' AND (
            (b.is_king_box = false AND t.box_id = b.id)
            OR
            (b.is_king_box = true AND t.box_id IN (SELECT id FROM boxes WHERE parent_box_id = b.id))
          ) THEN 1 
        END) as scanned_in_box_count,
        COUNT(CASE 
          WHEN t.current_status = 'not_scanned' AND (
            (b.is_king_box = false AND t.box_id = b.id)
            OR
            (b.is_king_box = true AND t.box_id IN (SELECT id FROM boxes WHERE parent_box_id = b.id))
          ) THEN 1 
        END) as not_scanned_in_box_count,
        AVG(
          CASE 
            WHEN t.current_status = 'delivered' THEN
              EXTRACT(EPOCH FROM (
                (SELECT MIN(sh2.timestamp) FROM status_history sh2 
                 WHERE sh2.tracking_number_id = t.id AND sh2.status = 'delivered')
                - 
                (SELECT MIN(sh1.timestamp) FROM status_history sh1 
                 WHERE sh1.tracking_number_id = t.id AND sh1.status = 'scanned')
              )) / 3600
            ELSE NULL
          END
        ) as avg_scan_to_delivery_hours,
        AVG(
          CASE 
            WHEN t.current_status IN ('scanned', 'delivered') THEN
              EXTRACT(EPOCH FROM (
                (SELECT MIN(sh1.timestamp) FROM status_history sh1 
                 WHERE sh1.tracking_number_id = t.id AND sh1.status = 'scanned')
                - t.created_at
              )) / 3600
            ELSE NULL
          END
        ) as avg_drop_to_scan_hours,
        AVG(
          EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - t.created_at)) / 3600
        ) as avg_time_from_added_hours
      FROM boxes b
      LEFT JOIN tracking_numbers t ON (
        -- For king boxes, include tracking numbers from all child boxes
        -- For regular boxes, only include directly assigned tracking numbers
        (
          (b.is_king_box = true AND EXISTS (SELECT 1 FROM boxes child WHERE child.parent_box_id = b.id AND child.id = t.box_id))
          OR
          (b.is_king_box = false AND b.id = t.box_id)
        )
      )
      ${boxWhereClause}
      GROUP BY b.id, b.name, b.created_at, b.parent_box_id, b.is_king_box
      ORDER BY COALESCE(MIN(t.created_at), b.created_at) ASC
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching box analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get detailed analytics for a specific box
router.get('/boxes/:boxId', async (req, res) => {
  try {
    const boxId = parseInt(req.params.boxId);
    
    // Get box info
    const boxResult = await pool.query('SELECT * FROM boxes WHERE id = $1', [boxId]);
    if (boxResult.rows.length === 0) {
      return res.status(404).json({ error: 'Box not found' });
    }
    
    const box = boxResult.rows[0];
    
    // Build WHERE clause: for king boxes, include tracking numbers from all child boxes
    let whereClause = '';
    if (box.is_king_box) {
      whereClause = 'WHERE t.box_id IN (SELECT id FROM boxes WHERE parent_box_id = $1)';
    } else {
      whereClause = 'WHERE t.box_id = $1';
    }
    
    // Get tracking numbers with time calculations
    const trackingResult = await pool.query(`
      SELECT 
        t.id,
        t.tracking_number,
        t.current_status,
        t.created_at as dropped_at,
        (SELECT MIN(sh1.timestamp) FROM status_history sh1 
         WHERE sh1.tracking_number_id = t.id AND sh1.status = 'scanned') as scanned_at,
        (SELECT MIN(sh2.timestamp) FROM status_history sh2 
         WHERE sh2.tracking_number_id = t.id AND sh2.status = 'delivered') as delivered_at,
        CASE 
          WHEN (SELECT MIN(sh1.timestamp) FROM status_history sh1 
                WHERE sh1.tracking_number_id = t.id AND sh1.status = 'scanned') IS NOT NULL
          THEN EXTRACT(EPOCH FROM (
            (SELECT MIN(sh1.timestamp) FROM status_history sh1 
             WHERE sh1.tracking_number_id = t.id AND sh1.status = 'scanned')
            - t.created_at
          )) / 3600
          ELSE NULL
        END as drop_to_scan_hours,
        CASE 
          WHEN (SELECT MIN(sh2.timestamp) FROM status_history sh2 
                WHERE sh2.tracking_number_id = t.id AND sh2.status = 'delivered') IS NOT NULL
          THEN EXTRACT(EPOCH FROM (
            (SELECT MIN(sh2.timestamp) FROM status_history sh2 
             WHERE sh2.tracking_number_id = t.id AND sh2.status = 'delivered')
            - 
            (SELECT MIN(sh1.timestamp) FROM status_history sh1 
             WHERE sh1.tracking_number_id = t.id AND sh1.status = 'scanned')
          )) / 3600
          ELSE NULL
        END as scan_to_delivery_hours,
        EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - t.created_at)) / 3600 as time_from_added_hours
      FROM tracking_numbers t
      ${whereClause}
      ORDER BY t.created_at DESC
    `, [boxId]);
    
    res.json({
      box: boxResult.rows[0],
      tracking_numbers: trackingResult.rows,
    });
  } catch (error) {
    console.error('Error fetching box analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get overall analytics
router.get('/overview', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) as total_items,
        COUNT(CASE WHEN current_status = 'not_scanned' THEN 1 END) as not_scanned_count,
        COUNT(CASE WHEN current_status = 'scanned' THEN 1 END) as scanned_count,
        COUNT(CASE WHEN current_status = 'delivered' THEN 1 END) as delivered_count,
        AVG(
          CASE 
            WHEN current_status = 'delivered' THEN
              EXTRACT(EPOCH FROM (
                (SELECT MIN(sh2.timestamp) FROM status_history sh2 
                 WHERE sh2.tracking_number_id = tracking_numbers.id AND sh2.status = 'delivered')
                - 
                (SELECT MIN(sh1.timestamp) FROM status_history sh1 
                 WHERE sh1.tracking_number_id = tracking_numbers.id AND sh1.status = 'scanned')
              )) / 3600
            ELSE NULL
          END
        ) as avg_scan_to_delivery_hours,
        AVG(
          CASE 
            WHEN current_status IN ('scanned', 'delivered') THEN
              EXTRACT(EPOCH FROM (
                (SELECT MIN(sh1.timestamp) FROM status_history sh1 
                 WHERE sh1.tracking_number_id = tracking_numbers.id AND sh1.status = 'scanned')
                - created_at
              )) / 3600
            ELSE NULL
          END
        ) as avg_drop_to_scan_hours
      FROM tracking_numbers
    `);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching overview analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;

