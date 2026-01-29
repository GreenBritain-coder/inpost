import { pool } from '../db/connection';

export interface EmailAccount {
  id: number;
  email: string;
  phone_number: string | null;
  app_password: string;
  host: string;
  port: number;
  is_active: boolean;
  last_checked_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Response type that masks the password */
export interface EmailAccountResponse {
  id: number;
  email: string;
  phone_number: string | null;
  host: string;
  port: number;
  is_active: boolean;
  last_checked_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Get all email accounts (with masked password for API responses) */
export async function getAllEmailAccounts(): Promise<EmailAccountResponse[]> {
  const result = await pool.query(
    `SELECT id, email, phone_number, host, port, is_active, last_checked_at, last_error, created_at, updated_at 
     FROM email_accounts 
     ORDER BY id`
  );
  return result.rows;
}

/** Get active email accounts (for the scraper to use) */
export async function getActiveEmailAccounts(): Promise<EmailAccount[]> {
  const result = await pool.query(
    `SELECT * FROM email_accounts WHERE is_active = true ORDER BY id`
  );
  return result.rows;
}

/** Get email account by ID (includes password for internal use) */
export async function getEmailAccountById(id: number): Promise<EmailAccount | null> {
  const result = await pool.query('SELECT * FROM email_accounts WHERE id = $1', [id]);
  return result.rows[0] || null;
}

/** Create a new email account */
export async function createEmailAccount(
  email: string,
  appPassword: string,
  phoneNumber?: string | null,
  host?: string,
  port?: number
): Promise<EmailAccountResponse> {
  const result = await pool.query(
    `INSERT INTO email_accounts (email, app_password, phone_number, host, port)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, phone_number, host, port, is_active, last_checked_at, last_error, created_at, updated_at`,
    [email, appPassword, phoneNumber || null, host || 'imap.gmail.com', port || 993]
  );
  return result.rows[0];
}

/** Update an email account */
export async function updateEmailAccount(
  id: number,
  data: {
    email?: string;
    app_password?: string;
    phone_number?: string | null;
    host?: string;
    port?: number;
    is_active?: boolean;
  }
): Promise<EmailAccountResponse | null> {
  const fields: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (data.email !== undefined) {
    fields.push(`email = $${paramIndex++}`);
    values.push(data.email);
  }
  if (data.app_password !== undefined) {
    fields.push(`app_password = $${paramIndex++}`);
    values.push(data.app_password);
  }
  if (data.phone_number !== undefined) {
    fields.push(`phone_number = $${paramIndex++}`);
    values.push(data.phone_number);
  }
  if (data.host !== undefined) {
    fields.push(`host = $${paramIndex++}`);
    values.push(data.host);
  }
  if (data.port !== undefined) {
    fields.push(`port = $${paramIndex++}`);
    values.push(data.port);
  }
  if (data.is_active !== undefined) {
    fields.push(`is_active = $${paramIndex++}`);
    values.push(data.is_active);
  }

  if (fields.length === 0) {
    return null;
  }

  fields.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);

  const result = await pool.query(
    `UPDATE email_accounts 
     SET ${fields.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING id, email, phone_number, host, port, is_active, last_checked_at, last_error, created_at, updated_at`,
    values
  );

  return result.rows[0] || null;
}

/** Delete an email account */
export async function deleteEmailAccount(id: number): Promise<boolean> {
  const result = await pool.query('DELETE FROM email_accounts WHERE id = $1 RETURNING id', [id]);
  return result.rowCount !== null && result.rowCount > 0;
}

/** Update the last checked timestamp and error for an email account */
export async function updateEmailAccountStatus(
  id: number,
  lastError: string | null
): Promise<void> {
  await pool.query(
    `UPDATE email_accounts 
     SET last_checked_at = CURRENT_TIMESTAMP, last_error = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [lastError, id]
  );
}

/** Update the last checked timestamp and error by email address */
export async function updateEmailAccountStatusByEmail(
  email: string,
  lastError: string | null
): Promise<void> {
  await pool.query(
    `UPDATE email_accounts 
     SET last_checked_at = CURRENT_TIMESTAMP, last_error = $1, updated_at = CURRENT_TIMESTAMP
     WHERE email = $2`,
    [lastError, email]
  );
}
