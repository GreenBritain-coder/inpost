-- Migration: Add email/telegram integration fields to tracking_numbers
-- This enables matching InPost emails to tracking numbers and sending pickup codes via Telegram

-- Add user/telegram fields for shipment creation
ALTER TABLE tracking_numbers 
ADD COLUMN IF NOT EXISTS user_id INTEGER,
ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT,
ADD COLUMN IF NOT EXISTS email_used VARCHAR(255);

-- Add pickup code and locker fields from email extraction
ALTER TABLE tracking_numbers
ADD COLUMN IF NOT EXISTS pickup_code VARCHAR(10),
ADD COLUMN IF NOT EXISTS locker_id VARCHAR(50),
ADD COLUMN IF NOT EXISTS pickup_code_sent_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS email_received_at TIMESTAMP;

-- Create index on tracking_number for fast lookups (already UNIQUE, but ensure index exists)
CREATE INDEX IF NOT EXISTS idx_tracking_number_lookup ON tracking_numbers(tracking_number);

-- Create index for email matching queries
CREATE INDEX IF NOT EXISTS idx_tracking_number_email ON tracking_numbers(tracking_number) WHERE email_used IS NOT NULL;

-- Add foreign key constraint if users table exists (optional, depends on your user management)
-- ALTER TABLE tracking_numbers ADD CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
