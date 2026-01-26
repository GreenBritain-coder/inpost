import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is not set!');
  console.error('Please set DATABASE_URL in your environment variables.');
  process.exit(1);
}

// Determine SSL configuration
// Only use SSL if explicitly enabled via DB_USE_SSL environment variable
// Coolify's internal PostgreSQL typically doesn't require SSL
const useSSL = process.env.DB_USE_SSL === 'true';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

