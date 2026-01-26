import { pool } from '../db/connection';
import { TrackingStatus } from './tracking';

export interface StatusHistory {
  id: number;
  tracking_number_id: number;
  status: TrackingStatus;
  timestamp: Date;
  notes: string | null;
}

export async function getStatusHistory(trackingNumberId: number): Promise<StatusHistory[]> {
  const result = await pool.query(
    'SELECT * FROM status_history WHERE tracking_number_id = $1 ORDER BY timestamp ASC',
    [trackingNumberId]
  );
  return result.rows;
}

export async function getStatusHistoryByBox(boxId: number): Promise<StatusHistory[]> {
  const result = await pool.query(`
    SELECT sh.*
    FROM status_history sh
    JOIN tracking_numbers t ON sh.tracking_number_id = t.id
    WHERE t.box_id = $1
    ORDER BY sh.timestamp ASC
  `, [boxId]);
  return result.rows;
}

export interface StatusChangeLog {
  id: number;
  tracking_number: string;
  old_status: string | null;
  new_status: string;
  status_details: string | null;
  box_name: string | null;
  changed_at: Date;
  change_type: 'status_change' | 'details_update';
}

export interface ScannedChangeLog {
  id: number;
  tracking_number: string;
  box_name: string | null;
  box_id: number | null;
  box_color_state: 'red' | 'yellow' | 'green';
  changed_at: Date;
  status_details: string | null;
  current_status: 'not_scanned' | 'scanned' | 'delivered';
}

export async function getRecentStatusChanges(
  limit: number = 50,
  changeType?: 'status_change' | 'details_update',
  status?: 'not_scanned' | 'scanned' | 'delivered',
  boxId?: number,
  trackingNumberSearch?: string
): Promise<StatusChangeLog[]> {
  let query = `
    WITH status_changes AS (
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
    )
    SELECT * FROM status_changes
    WHERE 1=1
  `;
  
  const params: any[] = [];
  let paramCount = 0;

  if (changeType) {
    paramCount++;
    query += ` AND change_type = $${paramCount}`;
    params.push(changeType);
  }

  if (status) {
    paramCount++;
    query += ` AND new_status = $${paramCount}`;
    params.push(status);
  }

  if (boxId) {
    paramCount++;
    query += ` AND box_id = $${paramCount}`;
    params.push(boxId);
  }

  if (trackingNumberSearch) {
    paramCount++;
    query += ` AND tracking_number ILIKE $${paramCount}`;
    params.push(`%${trackingNumberSearch}%`);
  }

  query += ` ORDER BY changed_at DESC LIMIT $${paramCount + 1}`;
  params.push(limit);

  const result = await pool.query(query, params);
  return result.rows;
}

export async function getRecentScannedChanges(limit: number = 50): Promise<ScannedChangeLog[]> {
  const query = `
    WITH status_with_lag AS (
      SELECT
        sh.id,
        sh.tracking_number_id,
        sh.status,
        sh.timestamp,
        lag(sh.status) OVER (PARTITION BY sh.tracking_number_id ORDER BY sh.timestamp) as old_status
      FROM status_history sh
    ),
    first_scans AS (
      SELECT
        swl.id,
        swl.tracking_number_id,
        swl.timestamp as changed_at
      FROM status_with_lag swl
      WHERE swl.status = 'scanned'
        AND (swl.old_status IS NULL OR swl.old_status = 'not_scanned')
    ),
    scanned_changes AS (
      SELECT
        fs.id,
        t.tracking_number,
        b.name as box_name,
        b.id as box_id,
        fs.changed_at,
        t.status_details,
        t.current_status
      FROM first_scans fs
      JOIN tracking_numbers t ON fs.tracking_number_id = t.id
      LEFT JOIN boxes b ON t.box_id = b.id
      WHERE t.current_status = 'scanned'
        AND t.item_received IS NOT NULL
        AND ABS(EXTRACT(EPOCH FROM (fs.changed_at - t.item_received))) < 86400
    ),
    box_color_states AS (
      SELECT
        sc.*,
        CASE
          WHEN sc.box_id IS NULL THEN 'red'
          WHEN EXISTS (
            SELECT 1 FROM tracking_numbers t2
            WHERE t2.box_id = sc.box_id
              AND t2.current_status = 'not_scanned'
          ) THEN 'red'
          WHEN EXISTS (
            SELECT 1 FROM tracking_numbers t2
            WHERE t2.box_id = sc.box_id
              AND t2.current_status = 'scanned'
          ) THEN 'yellow'
          ELSE 'green'
        END as box_color_state
      FROM scanned_changes sc
    )
    SELECT 
      id,
      tracking_number,
      box_name,
      box_id,
      box_color_state,
      changed_at,
      status_details,
      current_status
    FROM box_color_states
    ORDER BY changed_at DESC
    LIMIT $1
  `;
  
  const result = await pool.query(query, [limit]);
  return result.rows;
}
