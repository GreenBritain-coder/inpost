import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { getTrackingNumberByTrackingNumber, updateTrackingStatus } from '../models/tracking';
import { TrackingStatus } from '../models/tracking';

const router = express.Router();

// Webhook secret from environment variable
const WEBHOOK_SECRET = process.env.TRACKINGMORE_WEBHOOK_SECRET || '';
// Allow disabling signature verification for testing (set DISABLE_WEBHOOK_VERIFICATION=true)
const DISABLE_VERIFICATION = process.env.DISABLE_WEBHOOK_VERIFICATION === 'true';

/**
 * Verify webhook signature using SHA256
 * TrackingMore sends signature in 'signature' header
 * Some providers include timestamp in signature calculation
 */
function verifyWebhookSignature(body: string, signature: string, timestamp?: string): boolean {
  if (!WEBHOOK_SECRET) {
    console.warn('WEBHOOK_SECRET not configured, skipping signature verification');
    return true; // Allow if secret not configured (for development)
  }

  if (!signature) {
    console.warn('No signature provided in webhook request');
    return false;
  }

  // Remove any prefix from signature (e.g., "sha256=" or "sha256:")
  const cleanSignature = signature.replace(/^(sha256[=:]|)/i, '').trim();

  // Try multiple signature formats that TrackingMore might use
  const signaturesToTry: { method: string; signature: string }[] = [];

  // Method 1: HMAC-SHA256(body, secret) - most common
  const sig1 = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(body)
    .digest('hex');
  signaturesToTry.push({ method: 'body only', signature: sig1 });

  // Method 2: HMAC-SHA256(timestamp + body, secret) - if timestamp provided
  if (timestamp) {
    const sig2 = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(timestamp + body)
      .digest('hex');
    signaturesToTry.push({ method: 'timestamp + body', signature: sig2 });
  }

  // Method 3: HMAC-SHA256(body + timestamp, secret) - alternative format
  if (timestamp) {
    const sig3 = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(body + timestamp)
      .digest('hex');
    signaturesToTry.push({ method: 'body + timestamp', signature: sig3 });
  }

  console.log('Signature verification details:');
  console.log('  Received signature length:', cleanSignature.length);
  console.log('  Received signature (first 20 chars):', cleanSignature.substring(0, 20));
  console.log('  Timestamp from header:', timestamp || 'not provided');
  console.log('  Trying', signaturesToTry.length, 'signature methods...');

  // Try each signature method
  for (const { method, signature: expectedSig } of signaturesToTry) {
    console.log(`  Method "${method}": expected (first 20 chars): ${expectedSig.substring(0, 20)}`);
    
    if (cleanSignature.length !== expectedSig.length) {
      continue; // Length mismatch, try next method
    }

    try {
      const result = crypto.timingSafeEqual(
        Buffer.from(cleanSignature, 'hex'),
        Buffer.from(expectedSig, 'hex')
      );
      if (result) {
        console.log(`  ✓ Signature verified using method: ${method}`);
        return true;
      }
    } catch (error) {
      // Try string comparison as fallback
      if (cleanSignature.toLowerCase() === expectedSig.toLowerCase()) {
        console.log(`  ✓ Signature verified using method: ${method} (string comparison)`);
        return true;
      }
    }
  }

  console.error('✗ Signature verification failed - none of the methods matched');
  console.error('  Make sure TRACKINGMORE_WEBHOOK_SECRET matches the secret configured in TrackingMore dashboard');
  return false;
}

/**
 * Map TrackingMore delivery_status to our TrackingStatus enum
 */
function mapDeliveryStatus(deliveryStatus: string | null | undefined): TrackingStatus {
  if (!deliveryStatus) {
    return 'not_scanned';
  }

  const statusLower = deliveryStatus.toLowerCase();

  if (statusLower === 'delivered' || statusLower.includes('delivered')) {
    return 'delivered';
  } else if (
    statusLower === 'transit' ||
    statusLower === 'pickup' ||
    statusLower === 'inforeceived' ||
    statusLower.includes('transit') ||
    statusLower.includes('pickup')
  ) {
    return 'scanned';
  } else {
    return 'not_scanned';
  }
}

/**
 * Extract status header from webhook payload
 */
function extractStatusHeader(webhookData: any): string | undefined {
  // Try multiple possible fields for status description
  // latest_event is an object, extract description if it exists
  if (webhookData.latest_event) {
    if (typeof webhookData.latest_event === 'string') {
      return webhookData.latest_event;
    } else if (webhookData.latest_event.description) {
      return webhookData.latest_event.description;
    }
  }
  return (
    webhookData.delivery_status ||
    webhookData.substatus ||
    webhookData.status_info ||
    undefined
  );
}

/**
 * Root test endpoint - verify webhook router is accessible
 */
router.get('/', (req: Request, res: Response) => {
  console.log('Webhook root endpoint accessed');
  res.json({ 
    message: 'Webhook router is accessible',
    endpoints: ['GET /trackingmore/test', 'POST /trackingmore']
  });
});

/**
 * Test endpoint to verify webhook route is accessible
 * This should return JSON, not a blank page
 * Must be defined BEFORE the catch-all route
 */
router.get('/trackingmore/test', (req: Request, res: Response) => {
  console.log('=== TEST ENDPOINT ACCESSED ===');
  console.log('Method:', req.method);
  console.log('Path:', req.path);
  console.log('URL:', req.url);
  console.log('Original URL:', req.originalUrl);
  
  try {
    res.setHeader('Content-Type', 'application/json');
    const response = { 
      message: 'Webhook endpoint is accessible', 
      timestamp: new Date().toISOString(),
      webhookSecretConfigured: !!WEBHOOK_SECRET,
      path: '/api/webhook/trackingmore/test',
      method: req.method,
      routerPath: req.path,
      originalUrl: req.originalUrl
    };
    console.log('Sending response:', response);
    res.json(response);
  } catch (error) {
    console.error('Error in test endpoint:', error);
    res.status(500).json({ error: 'Internal server error', details: error instanceof Error ? error.message : String(error) });
  }
});

/**
 * TrackingMore webhook endpoint
 * Receives POST requests from TrackingMore when tracking status changes
 * Must be defined BEFORE the catch-all route
 */
router.post('/trackingmore', async (req: any, res: Response) => {
  // Enhanced logging - log ALL incoming requests
  console.log('=== WEBHOOK REQUEST RECEIVED ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Has body:', !!req.body);
  console.log('Body type:', typeof req.body);
  
  try {
    // Get raw body for signature verification
    // Use rawBody if available (from middleware), otherwise stringify the parsed body
    const rawBody = req.rawBody || (req.body ? JSON.stringify(req.body) : '');
    console.log('Raw body length:', rawBody.length);
    console.log('Raw body preview:', rawBody.substring(0, 200));
    console.log('Has rawBody from middleware:', !!req.rawBody);
    
    // Get signature from header
    // TrackingMore sends signature in 'signature' header
    const signature = req.headers['signature'] as string || 
                     req.headers['x-signature'] as string || 
                     req.headers['x-trackingmore-signature'] as string ||
                     req.headers['x-hub-signature-256'] as string;
    
    // Get timestamp if provided (some providers include it in signature)
    const timestamp = req.headers['timestamp'] as string || 
                     req.headers['x-timestamp'] as string;
    
    console.log('All signature-related headers:');
    console.log('  signature:', req.headers['signature']);
    console.log('  x-signature:', req.headers['x-signature']);
    console.log('  x-trackingmore-signature:', req.headers['x-trackingmore-signature']);
    console.log('  x-hub-signature-256:', req.headers['x-hub-signature-256']);
    console.log('  timestamp:', timestamp || 'not provided');
    console.log('Signature header present:', !!signature);
    console.log('Webhook secret configured:', !!WEBHOOK_SECRET);
    console.log('Webhook secret length:', WEBHOOK_SECRET.length);

    // Verify webhook signature (if secret is configured and verification not disabled)
    if (DISABLE_VERIFICATION) {
      console.warn('⚠️  Webhook signature verification DISABLED (DISABLE_WEBHOOK_VERIFICATION=true)');
      console.warn('⚠️  This should only be used for testing. Enable verification in production!');
    } else if (WEBHOOK_SECRET) {
      if (!signature) {
        console.error('Webhook signature verification failed: No signature header found');
        return res.status(401).json({ error: 'Missing signature header' });
      }
      
      const isValid = verifyWebhookSignature(rawBody, signature, timestamp);
      if (!isValid) {
        console.error('Webhook signature verification failed');
        console.error('Tried multiple signature formats: body only, timestamp + body, body + timestamp');
        console.error('Make sure TRACKINGMORE_WEBHOOK_SECRET in Coolify matches the secret configured in TrackingMore dashboard');
        console.error('To verify: Check TrackingMore dashboard > Settings > Webhooks > Webhook Secret');
        console.error('Temporary workaround: Set DISABLE_WEBHOOK_VERIFICATION=true in Coolify environment variables');
        return res.status(401).json({ error: 'Invalid signature' });
      } else {
        console.log('✓ Webhook signature verified successfully');
      }
    } else {
      console.warn('Webhook secret not configured - skipping signature verification (development mode)');
    }

    // Use parsed body (from express.json middleware) or parse raw body
    const webhookData = req.body || JSON.parse(rawBody);

    // Log webhook received
    console.log('=== WEBHOOK PAYLOAD ===');
    console.log('Webhook received from TrackingMore:', JSON.stringify(webhookData, null, 2).substring(0, 1000));

    // Extract tracking information from webhook payload
    // TrackingMore webhook structure: { code, message, data: { tracking_number, delivery_status, ... } }
    const trackingData = webhookData.data || webhookData;
    
    if (!trackingData.tracking_number) {
      console.error('Webhook payload missing tracking_number');
      return res.status(400).json({ error: 'Missing tracking_number in payload' });
    }

    const trackingNumber = trackingData.tracking_number;
    const deliveryStatus = trackingData.delivery_status;
    const statusHeader = extractStatusHeader(trackingData);
    
    // Extract ItemReceived - time when first tracking info appeared
    const itemReceived = trackingData?.ItemReceived || 
                        trackingData?.item_received || 
                        trackingData?.itemReceived ||
                        null;
    
    // Get the most detailed TrackingMore status
    // latest_event is an object with description, time_iso, location - extract description
    let trackingmoreStatus: string | undefined;
    if (trackingData.latest_event) {
      // latest_event is an object, extract the description or stringify it
      if (typeof trackingData.latest_event === 'string') {
        trackingmoreStatus = trackingData.latest_event;
      } else if (trackingData.latest_event.description) {
        trackingmoreStatus = trackingData.latest_event.description;
      } else {
        // If it's an object without description, stringify it
        trackingmoreStatus = JSON.stringify(trackingData.latest_event);
      }
    } else {
      trackingmoreStatus = trackingData.delivery_status || 
                          trackingData.status || 
                          trackingData.sub_status ||
                          trackingData.substatus ||
                          deliveryStatus;
    }

    console.log(`[${trackingNumber}] Webhook update: delivery_status=${deliveryStatus}, statusHeader=${statusHeader}, trackingmoreStatus=${trackingmoreStatus}`);

    // Find tracking in database
    const tracking = await getTrackingNumberByTrackingNumber(trackingNumber);
    
    if (!tracking) {
      console.log(`[${trackingNumber}] Webhook received for unknown tracking number, ignoring`);
      // Return 200 to acknowledge receipt (don't want TrackingMore to retry)
      return res.status(200).json({ message: 'Tracking number not found in database, ignored' });
    }

    // Skip if status was manually set
    if (tracking.is_manual_status) {
      console.log(`[${trackingNumber}] Webhook received but status is manually set, skipping automatic update`);
      return res.status(200).json({ 
        message: 'Status is manually set, skipping automatic update',
        tracking_number: trackingNumber
      });
    }

    // Map delivery_status to our TrackingStatus enum
    const mappedStatus = mapDeliveryStatus(deliveryStatus);

    // Only update if status changed or statusHeader is different or trackingmoreStatus changed
    const trackingmoreStatusChanged = trackingmoreStatus && trackingmoreStatus !== tracking.trackingmore_status;
    if (mappedStatus !== tracking.current_status || statusHeader !== tracking.status_details || trackingmoreStatusChanged) {
      await updateTrackingStatus(tracking.id, mappedStatus, statusHeader, undefined, false, trackingmoreStatus, itemReceived);
      console.log(
        `[${trackingNumber}] Webhook updated: ${tracking.current_status} -> ${mappedStatus}`,
        statusHeader ? `Header: ${statusHeader}` : '',
        trackingmoreStatus ? `TrackingMore Status: ${trackingmoreStatus}` : ''
      );
    } else {
      console.log(`[${trackingNumber}] Webhook received but no changes detected`);
    }

    // Return 200 to acknowledge receipt
    res.status(200).json({ 
      message: 'Webhook processed successfully',
      tracking_number: trackingNumber,
      status: mappedStatus
    });

  } catch (error) {
    console.error('Error processing webhook:', error);
    // Still return 200 to prevent TrackingMore from retrying
    // (we'll log the error for debugging)
    res.status(200).json({ error: 'Internal error processing webhook' });
  }
});

// Catch-all for webhook routes to help debug
// Must be LAST so it doesn't interfere with specific routes
router.all('/trackingmore/*', (req: Request, res: Response) => {
  console.log(`Unhandled webhook route: ${req.method} ${req.path}`);
  res.status(404).json({ 
    error: 'Webhook route not found',
    method: req.method,
    path: req.path,
    availableRoutes: ['GET /trackingmore/test', 'POST /trackingmore']
  });
});

export default router;

