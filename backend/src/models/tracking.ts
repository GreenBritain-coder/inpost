import { pool } from '../db/connection';

export type TrackingStatus = 'not_scanned' | 'scanned' | 'delivered';

export interface TrackingEvent {
  id: number;
  tracking_number_id: number;
  event_date: Date;
  location: string | null;
  status: string | null;
  description: string | null;
  checkpoint_status: string | null;
  created_at: Date;
}

export interface TrackingNumber {
  id: number;
  tracking_number: string;
  box_id: number | null;
  current_status: TrackingStatus;
  status_details: string | null;
  custom_timestamp: Date | null;
  is_manual_status: boolean;
  trackingmore_status: string | null;
  pickup_code: string | null;
  locker_id: string | null;
  first_scanned_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface TrackingNumberWithBox extends TrackingNumber {
  box_name: string | null;
}

export async function createTrackingNumber(
  trackingNumber: string,
  boxId: number | null = null,
  userId: number | null = null,
  telegramChatId: bigint | number | null = null,
  emailUsed: string | null = null
): Promise<TrackingNumber> {
  const result = await pool.query(
    `INSERT INTO tracking_numbers (tracking_number, box_id, current_status, user_id, telegram_chat_id, email_used)
     VALUES ($1, $2, 'not_scanned', $3, $4, $5)
     ON CONFLICT (tracking_number) DO UPDATE SET
       user_id = COALESCE(EXCLUDED.user_id, tracking_numbers.user_id),
       telegram_chat_id = COALESCE(EXCLUDED.telegram_chat_id, tracking_numbers.telegram_chat_id),
       email_used = COALESCE(EXCLUDED.email_used, tracking_numbers.email_used)
     RETURNING *`,
    [trackingNumber, boxId, userId, telegramChatId ? BigInt(telegramChatId).toString() : null, emailUsed]
  );
  
  if (result.rows.length === 0) {
    // Already exists, return existing
    const existing = await pool.query(
      'SELECT * FROM tracking_numbers WHERE tracking_number = $1',
      [trackingNumber]
    );
    return existing.rows[0];
  }
  
  // Create initial status history entry
  await pool.query(
    'INSERT INTO status_history (tracking_number_id, status) VALUES ($1, $2)',
    [result.rows[0].id, 'not_scanned']
  );
  
  return result.rows[0];
}

export async function getAllTrackingNumbers(
  page: number = 1,
  limit: number = 50,
  status?: TrackingStatus,
  customTimestamp?: string,
  search?: string,
  unassignedOnly?: boolean,
  kingBoxId?: number | null
): Promise<{ 
  data: TrackingNumberWithBox[]; 
  total: number; 
  page: number; 
  limit: number;
  stats: {
    not_scanned: number;
    scanned: number;
    delivered: number;
    total: number;
  };
}> {
  const offset = (page - 1) * limit;

  // Build all parameters in order
  const queryParams: any[] = [];
  const conditions: string[] = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`t.current_status = $${paramIndex}`);
    queryParams.push(status);
    paramIndex++;
  }

  if (customTimestamp) {
    // Use date range to match the entire day (ignoring time)
    const startOfDay = new Date(customTimestamp + 'T00:00:00Z');
    const startOfNextDay = new Date(startOfDay);
    startOfNextDay.setUTCDate(startOfNextDay.getUTCDate() + 1);

    conditions.push(`t.custom_timestamp >= $${paramIndex}::TIMESTAMPTZ AND t.custom_timestamp < $${paramIndex + 1}::TIMESTAMPTZ`);
    queryParams.push(startOfDay.toISOString(), startOfNextDay.toISOString());
    paramIndex += 2;
  }

  if (search) {
    // Search in tracking_number field (case-insensitive, partial match)
    conditions.push(`t.tracking_number ILIKE $${paramIndex}`);
    queryParams.push(`%${search}%`);
    paramIndex++;
  }

  if (unassignedOnly) {
    conditions.push(`t.box_id IS NULL`);
  }

  // Filter by king box: show tracking numbers from all boxes that belong to this king box
  if (kingBoxId !== undefined && kingBoxId !== null) {
    conditions.push(`t.box_id IN (SELECT id FROM boxes WHERE parent_box_id = $${paramIndex})`);
    queryParams.push(kingBoxId);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get filtered stats based on the same conditions
  let stats = {
    not_scanned: 0,
    scanned: 0,
    delivered: 0,
    total: 0
  };

  if (conditions.length > 0) {
    // Calculate stats with filters applied
    const statsResult = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN t.current_status = 'not_scanned' THEN 1 END) as not_scanned,
        COUNT(CASE WHEN t.current_status = 'scanned' THEN 1 END) as scanned,
        COUNT(CASE WHEN t.current_status = 'delivered' THEN 1 END) as delivered
      FROM tracking_numbers t
      ${whereClause}
    `, queryParams);
    stats = {
      not_scanned: parseInt(statsResult.rows[0].not_scanned),
      scanned: parseInt(statsResult.rows[0].scanned),
      delivered: parseInt(statsResult.rows[0].delivered),
      total: parseInt(statsResult.rows[0].total)
    };
  } else {
    // No filters, get all stats
    const countResult = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN current_status = 'not_scanned' THEN 1 END) as not_scanned,
        COUNT(CASE WHEN current_status = 'scanned' THEN 1 END) as scanned,
        COUNT(CASE WHEN current_status = 'delivered' THEN 1 END) as delivered
      FROM tracking_numbers
    `);
    stats = {
      not_scanned: parseInt(countResult.rows[0].not_scanned),
      scanned: parseInt(countResult.rows[0].scanned),
      delivered: parseInt(countResult.rows[0].delivered),
      total: parseInt(countResult.rows[0].total)
    };
  }

  // Get filtered total count (same as stats.total when filtered)
  const filteredTotal = stats.total;

  // Add pagination parameters
  const limitParamIndex = paramIndex;
  const offsetParamIndex = paramIndex + 1;
  queryParams.push(limit, offset);

  // Get paginated data with filters
  const result = await pool.query(`
    SELECT
      t.*,
      b.name as box_name
    FROM tracking_numbers t
    LEFT JOIN boxes b ON t.box_id = b.id
    ${whereClause}
    ORDER BY t.created_at DESC
    LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
  `, queryParams);
  
  return {
    data: result.rows,
    total: filteredTotal,
    page,
    limit,
    stats
  };
}

export async function getTrackingNumbersByBox(
  boxId: number,
  page: number = 1,
  limit: number = 50,
  status?: TrackingStatus,
  customTimestamp?: string,
  search?: string
): Promise<{ 
  data: TrackingNumberWithBox[]; 
  total: number; 
  page: number; 
  limit: number;
  stats: {
    not_scanned: number;
    scanned: number;
    delivered: number;
    total: number;
  };
}> {
  const offset = (page - 1) * limit;

  // Build all parameters in order
  const queryParams: any[] = [boxId]; // box_id is always $1
  const conditions: string[] = [`t.box_id = $1`];
  let paramIndex = 2;

  if (status) {
    conditions.push(`t.current_status = $${paramIndex}`);
    queryParams.push(status);
    paramIndex++;
  }

  if (customTimestamp) {
    // Use date range to match the entire day (ignoring time)
    const startOfDay = new Date(customTimestamp + 'T00:00:00Z');
    const startOfNextDay = new Date(startOfDay);
    startOfNextDay.setUTCDate(startOfNextDay.getUTCDate() + 1);

    conditions.push(`t.custom_timestamp >= $${paramIndex}::TIMESTAMPTZ AND t.custom_timestamp < $${paramIndex + 1}::TIMESTAMPTZ`);
    queryParams.push(startOfDay.toISOString(), startOfNextDay.toISOString());
    paramIndex += 2;
  }

  if (search) {
    // Search in tracking_number field (case-insensitive, partial match)
    conditions.push(`t.tracking_number ILIKE $${paramIndex}`);
    queryParams.push(`%${search}%`);
    paramIndex++;
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  // Get total count and stats for this box (always get all stats, not filtered)
  const countResult = await pool.query(`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN current_status = 'not_scanned' THEN 1 END) as not_scanned,
      COUNT(CASE WHEN current_status = 'scanned' THEN 1 END) as scanned,
      COUNT(CASE WHEN current_status = 'delivered' THEN 1 END) as delivered
    FROM tracking_numbers
    WHERE box_id = $1
  `, [boxId]);
  const total = parseInt(countResult.rows[0].total);
  const stats = {
    not_scanned: parseInt(countResult.rows[0].not_scanned),
    scanned: parseInt(countResult.rows[0].scanned),
    delivered: parseInt(countResult.rows[0].delivered),
    total
  };

  // Get filtered total count
  let filteredTotal = total;
  if (conditions.length > 1) {
    const filteredCountResult = await pool.query(`
      SELECT COUNT(*) as total
      FROM tracking_numbers t
      ${whereClause}
    `, queryParams);
    filteredTotal = parseInt(filteredCountResult.rows[0].total);
  }

  // Add pagination parameters
  const limitParamIndex = paramIndex;
  const offsetParamIndex = paramIndex + 1;
  queryParams.push(limit, offset);

  // Get paginated data with filters
  const result = await pool.query(`
    SELECT
      t.*,
      b.name as box_name
    FROM tracking_numbers t
    LEFT JOIN boxes b ON t.box_id = b.id
    ${whereClause}
    ORDER BY t.created_at DESC
    LIMIT $${limitParamIndex} OFFSET $${offsetParamIndex}
  `, queryParams);
  
  return {
    data: result.rows,
    total: filteredTotal,
    page,
    limit,
    stats
  };
}

export async function getTrackingNumberById(id: number): Promise<TrackingNumber | null> {
  const result = await pool.query('SELECT * FROM tracking_numbers WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function getTrackingNumberByTrackingNumber(trackingNumber: string): Promise<TrackingNumber | null> {
  const result = await pool.query('SELECT * FROM tracking_numbers WHERE tracking_number = $1', [trackingNumber]);
  return result.rows[0] || null;
}

export async function updateTrackingNumberBox(
  id: number,
  boxId: number | null
): Promise<TrackingNumber | null> {
  const result = await pool.query(
    'UPDATE tracking_numbers SET box_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
    [boxId, id]
  );
  return result.rows[0] || null;
}

export async function updateTrackingStatus(
  id: number,
  status: TrackingStatus,
  statusDetails?: string,
  customTimestamp?: Date | null,
  isManual: boolean = false,
  trackingmoreStatus?: string | null,
  itemReceived?: Date | string | null
): Promise<TrackingNumber | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get current tracking number info for logging
    const currentInfo = await client.query(
      'SELECT tracking_number, current_status, status_details, first_scanned_at FROM tracking_numbers WHERE id = $1',
      [id]
    );

    if (currentInfo.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const currentTrackingNumber = currentInfo.rows[0];
    const oldStatus = currentTrackingNumber.current_status;
    const oldStatusDetails = currentTrackingNumber.status_details;
    
    // Check if this is the first time changing from not_scanned to scanned
    const isFirstScan = oldStatus === 'not_scanned' && status === 'scanned' && !currentTrackingNumber.first_scanned_at;

    // If customTimestamp is undefined, preserve the existing value
    // Only update custom_timestamp if it's explicitly provided (including null to clear it)
    const shouldUpdateCustomTimestamp = customTimestamp !== undefined;

    // Convert itemReceived to Date if provided
    const itemReceivedDate = itemReceived 
      ? (itemReceived instanceof Date ? itemReceived : new Date(itemReceived))
      : null;

    let updateResult;
    if (shouldUpdateCustomTimestamp) {
      // Update including custom_timestamp
      updateResult = await client.query(
        `UPDATE tracking_numbers
         SET current_status = $1,
             status_details = $2,
             custom_timestamp = $3,
             is_manual_status = $4,
             trackingmore_status = $5,
             item_received = $6,
             first_scanned_at = CASE WHEN $7 THEN CURRENT_TIMESTAMP ELSE first_scanned_at END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $8
         RETURNING *`,
        [status, statusDetails || null, customTimestamp, isManual, trackingmoreStatus || null, itemReceivedDate, isFirstScan, id]
      );
    } else {
      // Update without changing custom_timestamp (preserve existing value)
      // Only update trackingmore_status if provided
      if (trackingmoreStatus !== undefined) {
        updateResult = await client.query(
          `UPDATE tracking_numbers
           SET current_status = $1,
               status_details = $2,
               is_manual_status = $3,
               trackingmore_status = $4,
               item_received = $5,
               first_scanned_at = CASE WHEN $6 THEN CURRENT_TIMESTAMP ELSE first_scanned_at END,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $7
           RETURNING *`,
          [status, statusDetails || null, isManual, trackingmoreStatus || null, itemReceivedDate, isFirstScan, id]
        );
      } else {
        updateResult = await client.query(
          `UPDATE tracking_numbers
           SET current_status = $1,
               status_details = $2,
               is_manual_status = $3,
               item_received = $4,
               first_scanned_at = CASE WHEN $5 THEN CURRENT_TIMESTAMP ELSE first_scanned_at END,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $6
           RETURNING *`,
          [status, statusDetails || null, isManual, itemReceivedDate, isFirstScan, id]
        );
      }
    }

    if (updateResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    // Add to status history
    await client.query(
      'INSERT INTO status_history (tracking_number_id, status) VALUES ($1, $2)',
      [id, status]
    );

    await client.query('COMMIT');

    // Log the status change
    const trackingNumber = updateResult.rows[0].tracking_number;
    const timestamp = new Date().toISOString();

    if (oldStatus !== status) {
      console.log(`[${timestamp}] STATUS_CHANGE: ${trackingNumber} - ${oldStatus} → ${status}${statusDetails ? ` (${statusDetails})` : ''}${isManual ? ' [MANUAL]' : ''}`);
    } else if (oldStatusDetails !== (statusDetails || null)) {
      console.log(`[${timestamp}] DETAILS_UPDATE: ${trackingNumber} - Status details updated: "${oldStatusDetails || '(empty)'}" → "${statusDetails || '(empty)'}"`);
    }

    return updateResult.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteTrackingNumber(id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM tracking_numbers WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

export async function deleteAllTrackingNumbers(): Promise<number> {
  const result = await pool.query('DELETE FROM tracking_numbers');
  return result.rowCount ?? 0;
}

export async function bulkDeleteTrackingNumbers(ids: number[]): Promise<number> {
  if (ids.length === 0) {
    return 0;
  }
  const result = await pool.query(
    'DELETE FROM tracking_numbers WHERE id = ANY($1::int[])',
    [ids]
  );
  return result.rowCount ?? 0;
}

export async function bulkCreateTrackingNumbers(
  trackingNumbers: string[],
  boxId: number | null = null,
  customTimestamp: Date | null = null
): Promise<TrackingNumber[]> {
  const results: TrackingNumber[] = [];
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    for (const tn of trackingNumbers) {
      console.log(`Inserting tracking number: ${tn.trim()}, customTimestamp: ${customTimestamp}, type: ${typeof customTimestamp}`);
      const result = await client.query(
        `INSERT INTO tracking_numbers (tracking_number, box_id, current_status, custom_timestamp)
         VALUES ($1, $2, 'not_scanned', $3)
         ON CONFLICT (tracking_number) DO NOTHING
         RETURNING *`,
        [tn.trim(), boxId, customTimestamp]
      );
      
      if (result.rows.length > 0) {
        console.log(`Created tracking number ${tn.trim()} with custom_timestamp: ${result.rows[0].custom_timestamp}`);
        results.push(result.rows[0]);
        // Create initial status history entry
        await client.query(
          'INSERT INTO status_history (tracking_number_id, status) VALUES ($1, $2)',
          [result.rows[0].id, 'not_scanned']
        );
      } else {
        console.log(`Tracking number ${tn.trim()} already exists, skipped (ON CONFLICT DO NOTHING)`);
      }
    }
    
    await client.query('COMMIT');
    return results;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Save tracking events from TrackingMore API
 */
export async function saveTrackingEvents(
  trackingNumberId: number,
  events: Array<{
    event_date: Date | string;
    location?: string | null;
    status?: string | null;
    description?: string | null;
    checkpoint_status?: string | null;
  }>
): Promise<void> {
  if (!events || events.length === 0) {
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Delete existing events for this tracking number to avoid duplicates
    await client.query(
      'DELETE FROM tracking_events WHERE tracking_number_id = $1',
      [trackingNumberId]
    );

    // Insert new events
    for (const event of events) {
      const eventDate = event.event_date instanceof Date 
        ? event.event_date 
        : new Date(event.event_date);
      
      await client.query(
        `INSERT INTO tracking_events 
         (tracking_number_id, event_date, location, status, description, checkpoint_status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          trackingNumberId,
          eventDate,
          event.location || null,
          event.status || null,
          event.description || null,
          event.checkpoint_status || null
        ]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get tracking events for a tracking number
 */
export async function getTrackingEvents(trackingNumberId: number): Promise<TrackingEvent[]> {
  const result = await pool.query(
    `SELECT * FROM tracking_events 
     WHERE tracking_number_id = $1 
     ORDER BY event_date ASC`,
    [trackingNumberId]
  );
  
  return result.rows;
}

