import { pool } from '../db/connection';

export interface Postbox {
  id: number;
  name: string;
  created_at: Date;
  updated_at: Date;
}

export async function getAllPostboxes(): Promise<Postbox[]> {
  const result = await pool.query(
    'SELECT * FROM postboxes ORDER BY name ASC'
  );
  return result.rows;
}

export async function getPostboxById(id: number): Promise<Postbox | null> {
  const result = await pool.query('SELECT * FROM postboxes WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function createPostbox(name: string): Promise<Postbox> {
  const result = await pool.query(
    `INSERT INTO postboxes (name) 
     VALUES ($1) 
     ON CONFLICT (name) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [name]
  );
  return result.rows[0];
}

export async function updatePostbox(id: number, name: string): Promise<Postbox | null> {
  const result = await pool.query(
    `UPDATE postboxes 
     SET name = $1, updated_at = CURRENT_TIMESTAMP 
     WHERE id = $2 
     RETURNING *`,
    [name, id]
  );
  return result.rows[0] || null;
}

export async function deletePostbox(id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM postboxes WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

