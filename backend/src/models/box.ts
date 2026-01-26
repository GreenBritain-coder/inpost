import { pool } from '../db/connection';

export interface Box {
  id: number;
  name: string;
  parent_box_id: number | null;
  is_king_box: boolean;
  created_at: Date;
  updated_at?: Date;
}

export interface BoxWithChildren extends Box {
  children?: Box[];
}

export async function createBox(
  name: string,
  parentBoxId?: number | null,
  isKingBox: boolean = false
): Promise<Box> {
  const result = await pool.query(
    'INSERT INTO boxes (name, parent_box_id, is_king_box) VALUES ($1, $2, $3) RETURNING *',
    [name, parentBoxId || null, isKingBox]
  );
  return result.rows[0];
}

export async function getAllBoxes(kingBoxId?: number | null): Promise<Box[]> {
  if (kingBoxId !== undefined && kingBoxId !== null) {
    // Get boxes filtered by king box
    const result = await pool.query(
      'SELECT * FROM boxes WHERE parent_box_id = $1 ORDER BY created_at DESC',
      [kingBoxId]
    );
    return result.rows;
  }
  const result = await pool.query('SELECT * FROM boxes ORDER BY created_at DESC');
  return result.rows;
}

export async function getKingBoxes(): Promise<Box[]> {
  const result = await pool.query(
    'SELECT * FROM boxes WHERE is_king_box = true ORDER BY created_at DESC'
  );
  return result.rows;
}

export async function getBoxesByKingBox(kingBoxId: number): Promise<Box[]> {
  const result = await pool.query(
    'SELECT * FROM boxes WHERE parent_box_id = $1 ORDER BY created_at DESC',
    [kingBoxId]
  );
  return result.rows;
}

export async function getBoxById(id: number): Promise<Box | null> {
  const result = await pool.query('SELECT * FROM boxes WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function updateBox(
  id: number,
  name: string,
  parentBoxId?: number | null,
  isKingBox?: boolean
): Promise<Box | null> {
  // Build dynamic update query
  const updates: string[] = ['name = $1', 'updated_at = CURRENT_TIMESTAMP'];
  const params: any[] = [name];
  let paramIndex = 2;

  if (parentBoxId !== undefined) {
    updates.push(`parent_box_id = $${paramIndex}`);
    params.push(parentBoxId);
    paramIndex++;
  }

  if (isKingBox !== undefined) {
    updates.push(`is_king_box = $${paramIndex}`);
    params.push(isKingBox);
    paramIndex++;
  }

  params.push(id);
  const result = await pool.query(
    `UPDATE boxes 
     SET ${updates.join(', ')}
     WHERE id = $${paramIndex} 
     RETURNING *`,
    params
  );
  return result.rows[0] || null;
}

export async function deleteBox(id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM boxes WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

