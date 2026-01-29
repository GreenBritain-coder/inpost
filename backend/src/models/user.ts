import { pool } from '../db/connection';
import bcrypt from 'bcrypt';

export interface User {
  id: number;
  email: string;
  password_hash: string;
  telegram_chat_id?: bigint | null;
  telegram_user_id?: bigint | null;
  telegram_username?: string | null;
  created_at: Date;
}

/** Set Telegram chat ID for a user (when they /start or when we match by Telegram identity) */
export async function setTelegramChatId(userId: number, chatId: bigint | number, telegramUserId?: number | bigint | null): Promise<boolean> {
  const chatIdStr = typeof chatId === 'bigint' ? chatId.toString() : String(chatId);
  const telegramUserIdStr = telegramUserId != null ? String(telegramUserId) : null;
  const result = await pool.query(
    `UPDATE users SET telegram_chat_id = $1, telegram_user_id = COALESCE($2, telegram_user_id) WHERE id = $3 RETURNING id`,
    [chatIdStr, telegramUserIdStr, userId]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/** Find backend user by Telegram identity (from.id or @username) — for automatic linking on /start */
export async function findUserByTelegramIdentity(telegramUserId: number | bigint | null, telegramUsername: string | null): Promise<{ id: number } | null> {
  const tid = telegramUserId != null ? String(telegramUserId) : null;
  const username = telegramUsername ? telegramUsername.replace(/^@/, '').toLowerCase().trim() : null;

  if (tid) {
    const byId = await pool.query('SELECT id FROM users WHERE telegram_user_id = $1', [tid]);
    if (byId.rows[0]) return byId.rows[0];
  }
  if (username) {
    const byUsername = await pool.query(
      `SELECT id FROM users WHERE telegram_username IS NOT NULL AND LOWER(REPLACE(TRIM(telegram_username), '@', '')) = $1`,
      [username]
    );
    if (byUsername.rows[0]) return byUsername.rows[0];
  }
  return null;
}

/** Get user ID for a Telegram chat ID (who is this chat linked to?) */
export async function getUserIdByTelegramChatId(chatId: bigint | number): Promise<number | null> {
  const chatIdStr = typeof chatId === 'bigint' ? chatId.toString() : String(chatId);
  const result = await pool.query(
    'SELECT id FROM users WHERE telegram_chat_id = $1',
    [chatIdStr]
  );
  return result.rows[0]?.id ?? null;
}

/** Update a user's Telegram identity (for automatic linking when they /start the bot) */
export async function updateUserTelegramIdentity(
  userId: number,
  telegramUsername: string | null,
  telegramUserId: number | bigint | string | null
): Promise<boolean> {
  const tid = telegramUserId != null ? String(telegramUserId) : null;
  const result = await pool.query(
    `UPDATE users SET telegram_username = $1, telegram_user_id = $2 WHERE id = $3 RETURNING id`,
    [telegramUsername?.trim() || null, tid, userId]
  );
  return result.rowCount !== null && result.rowCount > 0;
}

/** Get user by ID (for admin) */
export async function getUserById(userId: number): Promise<User | null> {
  const result = await pool.query('SELECT id, email, created_at, telegram_chat_id, telegram_user_id, telegram_username FROM users WHERE id = $1', [userId]);
  return result.rows[0] ?? null;
}

/** Get Telegram chat ID for a user (for sending pickup notifications) */
export async function getTelegramChatIdByUserId(userId: number): Promise<bigint | null> {
  const result = await pool.query(
    'SELECT telegram_chat_id FROM users WHERE id = $1',
    [userId]
  );
  const val = result.rows[0]?.telegram_chat_id;
  if (val == null) return null;
  return BigInt(val);
}

export async function createUser(email: string, password: string): Promise<User> {
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at',
    [email, passwordHash]
  );
  return { ...result.rows[0], password_hash: passwordHash };
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  return result.rows[0] || null;
}

export async function verifyPassword(user: User, password: string): Promise<boolean> {
  return bcrypt.compare(password, user.password_hash);
}

