import cron from 'node-cron';
import { getAllTrackingNumbers, updateTrackingStatus, saveTrackingEvents } from '../models/tracking';
import { checkInPostStatus } from './scraper';
import { checkInPostEmails } from './emailScraper';
import { pool } from '../db/connection';

let isRunning = false;

export async function updateAllTrackingStatuses() {
  if (isRunning) {
    console.log('Update job already running, skipping...');
    return;
  }
  
  isRunning = true;
  console.log('Starting scheduled tracking update...');
  
  try {
    // Get all tracking numbers (use large limit to get all)
    const allTrackingNumbersResponse = await getAllTrackingNumbers(1, 10000);
    const allTrackingNumbers = allTrackingNumbersResponse.data;
    
    // Filter out delivered items AND manually set statuses
    const trackingNumbers = allTrackingNumbers.filter(tn => 
      tn.current_status !== 'delivered' && !tn.is_manual_status
    );
    const skippedDelivered = allTrackingNumbers.filter(tn => tn.current_status === 'delivered').length;
    const skippedManual = allTrackingNumbers.filter(tn => tn.is_manual_status).length;
    
    console.log(`Total tracking numbers: ${allTrackingNumbers.length}`);
    console.log(`Skipping ${skippedDelivered} delivered item(s) - no need to recheck`);
    console.log(`Skipping ${skippedManual} manually set item(s) - will not auto-update`);
    console.log(`Checking ${trackingNumbers.length} tracking number(s)...`);
    
    let updated = 0;
    let errors = 0;
    
    // If no tracking numbers to check, exit early
    if (trackingNumbers.length === 0) {
      console.log('No tracking numbers to check (all are delivered)');
      isRunning = false;
      return;
    }
    
    // Process sequentially to avoid rate limiting (API limit is 10 requests/second)
    // Add delay before each request to stay well under the limit
    for (const tn of trackingNumbers) {
      try {
        // Delay before each request to avoid rate limiting (500ms = max 2 requests/second, well under 10/sec limit)
        await new Promise((resolve) => setTimeout(resolve, 500));
        
        const result = await checkInPostStatus(tn.tracking_number);
        
        // Update if status changed OR if status_details is missing/empty but we have a statusHeader
        // OR if trackingmore_status changed
        const statusChanged = result.status !== tn.current_status;
        const needsStatusDetails = (!tn.status_details || tn.status_details === '-') && result.statusHeader;
        const statusDetailsChanged = result.statusHeader && result.statusHeader !== tn.status_details;
        const trackingmoreStatusChanged = result.trackingmoreStatus && result.trackingmoreStatus !== tn.trackingmore_status;
        
        if (statusChanged || needsStatusDetails || statusDetailsChanged || trackingmoreStatusChanged) {
          // Store the statusHeader (like "We've got it") in the status_details field
          // isManual=false for automatic updates
          await updateTrackingStatus(tn.id, result.status, result.statusHeader, undefined, false, result.trackingmoreStatus, result.itemReceived);
          
          // Save tracking events if available
          if (result.events && result.events.length > 0) {
            await saveTrackingEvents(tn.id, result.events);
            console.log(`Saved ${result.events.length} events for ${tn.tracking_number}`);
          }
          
          updated++;
          if (statusChanged) {
            console.log(
              `Updated ${tn.tracking_number}: ${tn.current_status} -> ${result.status}`,
              result.statusHeader ? `Header: ${result.statusHeader}` : ''
            );
          } else {
            console.log(
              `Updated status_details for ${tn.tracking_number}: ${tn.status_details || '(empty)'} -> ${result.statusHeader || '(empty)'}`
            );
          }
        }
      } catch (error) {
        errors++;
        console.error(`Error updating ${tn.tracking_number}:`, error);
        
        // If rate limited, wait longer before continuing
        // Per TrackingMore docs: wait 120 seconds after 429 error
        if (error instanceof Error && error.message.includes('429')) {
          console.log('Rate limit detected (429), waiting 120 seconds before continuing (per API docs)...');
          await new Promise((resolve) => setTimeout(resolve, 120000));
        }
      }
    }
    
    console.log(
      `Update complete. Updated: ${updated}, Errors: ${errors}, Checked: ${trackingNumbers.length}, Skipped (delivered): ${skippedDelivered}, Skipped (manual): ${skippedManual}, Total: ${allTrackingNumbers.length}`
    );
  } catch (error) {
    console.error('Error in scheduled update:', error);
  } finally {
    isRunning = false;
  }
}

export async function cleanupOldTrackingData() {
  let cutoffDate: Date;
  let deletedEvents = 0;
  let deletedHistory = 0;
  let deletedTracking = 0;
  let errorMessage: string | null = null;
  
  try {
    console.log('Starting cleanup of old tracking data (5 weeks window)...');
    
    // Calculate cutoff date (5 weeks ago)
    cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - (5 * 7)); // 5 weeks = 35 days
    
    console.log(`Cutoff date: ${cutoffDate.toISOString()}`);
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Delete tracking_events older than 5 weeks
      const eventsResult = await client.query(
        'DELETE FROM tracking_events WHERE event_date < $1',
        [cutoffDate]
      );
      deletedEvents = eventsResult.rowCount || 0;
      console.log(`Deleted ${deletedEvents} old tracking_events`);
      
      // Delete status_history older than 5 weeks
      const historyResult = await client.query(
        'DELETE FROM status_history WHERE timestamp < $1',
        [cutoffDate]
      );
      deletedHistory = historyResult.rowCount || 0;
      console.log(`Deleted ${deletedHistory} old status_history entries`);
      
      // Delete tracking_numbers older than 5 weeks
      // CASCADE will automatically delete related status_history and tracking_events
      const trackingResult = await client.query(
        'DELETE FROM tracking_numbers WHERE created_at < $1',
        [cutoffDate]
      );
      deletedTracking = trackingResult.rowCount || 0;
      console.log(`Deleted ${deletedTracking} old tracking_numbers`);
      
      await client.query('COMMIT');
      
      // Log cleanup to database
      await client.query(
        `INSERT INTO cleanup_logs (cutoff_date, deleted_tracking_events, deleted_status_history, deleted_tracking_numbers, status)
         VALUES ($1, $2, $3, $4, 'success')`,
        [cutoffDate, deletedEvents, deletedHistory, deletedTracking]
      );
      
      console.log('Cleanup completed successfully');
    } catch (error) {
      await client.query('ROLLBACK');
      errorMessage = error instanceof Error ? error.message : String(error);
      
      // Log error to database
      try {
        await client.query(
          `INSERT INTO cleanup_logs (cutoff_date, deleted_tracking_events, deleted_status_history, deleted_tracking_numbers, status, error_message)
           VALUES ($1, $2, $3, $4, 'error', $5)`,
          [cutoffDate, deletedEvents, deletedHistory, deletedTracking, errorMessage]
        );
      } catch (logError) {
        console.error('Failed to log cleanup error:', logError);
      }
      
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error during cleanup:', error);
    if (!errorMessage) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
  }
}

export function startScheduler() {
  // Run every 4 hours (at the top of every 4th hour: 0:00, 4:00, 8:00, 12:00, 16:00, 20:00)
  cron.schedule('0 */4 * * *', () => {
    updateAllTrackingStatuses();
  });
  
  // Check InPost emails every 5 minutes for pickup codes
  cron.schedule('*/5 * * * *', async () => {
    try {
      console.log('[Scheduler] Checking InPost emails for pickup codes...');
      await checkInPostEmails();
    } catch (error) {
      console.error('[Scheduler] Error checking emails:', error);
    }
  });
  
  // Run cleanup daily at 2 AM
  cron.schedule('0 2 * * *', () => {
    cleanupOldTrackingData();
  });
  
  // Also run immediately on startup to get initial status
  console.log('Scheduler started. Will run every 4 hours.');
  console.log('Cleanup job scheduled to run daily at 2 AM.');
  // Run on startup to get initial status
  updateAllTrackingStatuses();
}

