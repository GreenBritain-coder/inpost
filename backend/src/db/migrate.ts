import { pool } from './connection';

async function migrate() {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create boxes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS boxes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add updated_at column to boxes if it doesn't exist
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='boxes' AND column_name='updated_at'
        ) THEN
          ALTER TABLE boxes ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        END IF;
      END $$;
    `);

    // Add parent_box_id column for king box hierarchy if it doesn't exist
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='boxes' AND column_name='parent_box_id'
        ) THEN
          ALTER TABLE boxes ADD COLUMN parent_box_id INTEGER REFERENCES boxes(id) ON DELETE SET NULL;
          CREATE INDEX IF NOT EXISTS idx_boxes_parent_box_id ON boxes(parent_box_id);
        END IF;
      END $$;
    `);

    // Add is_king_box column if it doesn't exist
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='boxes' AND column_name='is_king_box'
        ) THEN
          ALTER TABLE boxes ADD COLUMN is_king_box BOOLEAN DEFAULT FALSE;
        END IF;
      END $$;
    `);

    // Create postboxes table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS postboxes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create tracking_numbers table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tracking_numbers (
        id SERIAL PRIMARY KEY,
        tracking_number VARCHAR(255) UNIQUE NOT NULL,
        box_id INTEGER REFERENCES boxes(id) ON DELETE SET NULL,
        postbox_id INTEGER REFERENCES postboxes(id) ON DELETE SET NULL,
        current_status VARCHAR(20) DEFAULT 'not_scanned' CHECK (current_status IN ('not_scanned', 'scanned', 'delivered')),
        status_details TEXT,
        custom_timestamp TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add status_details column if it doesn't exist (for existing databases)
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='tracking_numbers' AND column_name='status_details'
        ) THEN
          ALTER TABLE tracking_numbers ADD COLUMN status_details TEXT;
        END IF;
      END $$;
    `);

    // Add postbox_id column if it doesn't exist
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='tracking_numbers' AND column_name='postbox_id'
        ) THEN
          ALTER TABLE tracking_numbers ADD COLUMN postbox_id INTEGER REFERENCES postboxes(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // Add custom_timestamp column if it doesn't exist
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='tracking_numbers' AND column_name='custom_timestamp'
        ) THEN
          ALTER TABLE tracking_numbers ADD COLUMN custom_timestamp TIMESTAMP;
        END IF;
      END $$;
    `);

    // Add is_manual_status column if it doesn't exist
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='tracking_numbers' AND column_name='is_manual_status'
        ) THEN
          ALTER TABLE tracking_numbers ADD COLUMN is_manual_status BOOLEAN DEFAULT FALSE;
        END IF;
      END $$;
    `);

    // Add trackingmore_status column if it doesn't exist
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='tracking_numbers' AND column_name='trackingmore_status'
        ) THEN
          ALTER TABLE tracking_numbers ADD COLUMN trackingmore_status VARCHAR(100);
        END IF;
      END $$;
    `);

    // Add item_received column if it doesn't exist (ItemReceived from TrackingMore API)
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='tracking_numbers' AND column_name='item_received'
        ) THEN
          ALTER TABLE tracking_numbers ADD COLUMN item_received TIMESTAMP;
        END IF;
      END $$;
    `);

    // Add first_scanned_at column if it doesn't exist (first time status changes from not_scanned to scanned)
    await pool.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='tracking_numbers' AND column_name='first_scanned_at'
        ) THEN
          ALTER TABLE tracking_numbers ADD COLUMN first_scanned_at TIMESTAMP;
        END IF;
      END $$;
    `);

    // Create status_history table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS status_history (
        id SERIAL PRIMARY KEY,
        tracking_number_id INTEGER NOT NULL REFERENCES tracking_numbers(id) ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL CHECK (status IN ('not_scanned', 'scanned', 'delivered')),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        notes TEXT
      )
    `);

    // Create tracking_events table for detailed event timeline
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tracking_events (
        id SERIAL PRIMARY KEY,
        tracking_number_id INTEGER NOT NULL REFERENCES tracking_numbers(id) ON DELETE CASCADE,
        event_date TIMESTAMP NOT NULL,
        location VARCHAR(255),
        status VARCHAR(100),
        description TEXT,
        checkpoint_status VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create cleanup_logs table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cleanup_logs (
        id SERIAL PRIMARY KEY,
        cutoff_date TIMESTAMP NOT NULL,
        deleted_tracking_events INTEGER DEFAULT 0,
        deleted_status_history INTEGER DEFAULT 0,
        deleted_tracking_numbers INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'success' CHECK (status IN ('success', 'error')),
        error_message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tracking_numbers_box_id ON tracking_numbers(box_id);
      CREATE INDEX IF NOT EXISTS idx_tracking_numbers_postbox_id ON tracking_numbers(postbox_id);
      CREATE INDEX IF NOT EXISTS idx_tracking_numbers_status ON tracking_numbers(current_status);
      CREATE INDEX IF NOT EXISTS idx_status_history_tracking_id ON status_history(tracking_number_id);
      CREATE INDEX IF NOT EXISTS idx_status_history_timestamp ON status_history(timestamp);
      CREATE INDEX IF NOT EXISTS idx_tracking_events_tracking_id ON tracking_events(tracking_number_id);
      CREATE INDEX IF NOT EXISTS idx_tracking_events_date ON tracking_events(event_date);
      CREATE INDEX IF NOT EXISTS idx_cleanup_logs_created_at ON cleanup_logs(created_at);
    `);

    // Nullify postbox_id in tracking_numbers (migrate away from postboxes)
    await pool.query(`
      UPDATE tracking_numbers 
      SET postbox_id = NULL 
      WHERE postbox_id IS NOT NULL
    `);

    // Add telegram_chat_id to users so we can send them pickup codes
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='telegram_chat_id') THEN
          ALTER TABLE users ADD COLUMN telegram_chat_id BIGINT;
        END IF;
      END $$;
    `);

    // Telegram identity for automatic linking when user sends /start (no link needed)
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='telegram_user_id') THEN
          ALTER TABLE users ADD COLUMN telegram_user_id BIGINT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='telegram_username') THEN
          ALTER TABLE users ADD COLUMN telegram_username VARCHAR(255);
        END IF;
      END $$;
    `);

    // Add email/telegram integration fields (if not exist)
    await pool.query(`
      DO $$ 
      BEGIN
        -- Add user/telegram fields for shipment creation
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tracking_numbers' AND column_name='user_id') THEN
          ALTER TABLE tracking_numbers ADD COLUMN user_id INTEGER;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tracking_numbers' AND column_name='telegram_chat_id') THEN
          ALTER TABLE tracking_numbers ADD COLUMN telegram_chat_id BIGINT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tracking_numbers' AND column_name='email_used') THEN
          ALTER TABLE tracking_numbers ADD COLUMN email_used VARCHAR(255);
        END IF;
        
        -- Add pickup code and locker fields from email extraction
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tracking_numbers' AND column_name='pickup_code') THEN
          ALTER TABLE tracking_numbers ADD COLUMN pickup_code VARCHAR(10);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tracking_numbers' AND column_name='locker_id') THEN
          ALTER TABLE tracking_numbers ADD COLUMN locker_id VARCHAR(50);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tracking_numbers' AND column_name='pickup_code_sent_at') THEN
          ALTER TABLE tracking_numbers ADD COLUMN pickup_code_sent_at TIMESTAMP;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tracking_numbers' AND column_name='email_received_at') THEN
          ALTER TABLE tracking_numbers ADD COLUMN email_received_at TIMESTAMP;
        END IF;
        
        -- Add send code fields from sender/drop-off email extraction
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tracking_numbers' AND column_name='send_code') THEN
          ALTER TABLE tracking_numbers ADD COLUMN send_code VARCHAR(15);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tracking_numbers' AND column_name='send_code_sent_at') THEN
          ALTER TABLE tracking_numbers ADD COLUMN send_code_sent_at TIMESTAMP;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tracking_numbers' AND column_name='send_email_received_at') THEN
          ALTER TABLE tracking_numbers ADD COLUMN send_email_received_at TIMESTAMP;
        END IF;
        
        -- Add recipient name from sender email
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tracking_numbers' AND column_name='recipient_name') THEN
          ALTER TABLE tracking_numbers ADD COLUMN recipient_name VARCHAR(255);
        END IF;
      END $$;
    `);

    // Create indexes for email matching
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tracking_number_lookup ON tracking_numbers(tracking_number);
      CREATE INDEX IF NOT EXISTS idx_tracking_number_email ON tracking_numbers(tracking_number) WHERE email_used IS NOT NULL;
    `);

    // Add 'cancelled' status to tracking_numbers check constraint
    // Using table_constraints (not constraint_column_usage) for proper constraint checking
    await pool.query(`
      DO $$ 
      BEGIN
        -- Drop old constraint if exists
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE constraint_name = 'tracking_numbers_current_status_check'
            AND table_name = 'tracking_numbers'
            AND table_schema = 'public'
        ) THEN
          ALTER TABLE tracking_numbers DROP CONSTRAINT tracking_numbers_current_status_check;
        END IF;
        
        -- Add new constraint with 'cancelled'
        ALTER TABLE tracking_numbers 
        ADD CONSTRAINT tracking_numbers_current_status_check 
        CHECK (current_status IN ('not_scanned', 'scanned', 'delivered', 'cancelled'));
      END $$;
    `);

    // Add 'cancelled' status to status_history check constraint
    // Using table_constraints (not constraint_column_usage) for proper constraint checking
    await pool.query(`
      DO $$ 
      BEGIN
        -- Drop old constraint if exists
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE constraint_name = 'status_history_status_check'
            AND table_name = 'status_history'
            AND table_schema = 'public'
        ) THEN
          ALTER TABLE status_history DROP CONSTRAINT status_history_status_check;
        END IF;
        
        -- Add new constraint with 'cancelled'
        ALTER TABLE status_history 
        ADD CONSTRAINT status_history_status_check 
        CHECK (status IN ('not_scanned', 'scanned', 'delivered', 'cancelled'));
      END $$;
    `);

    console.log('Database migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();
