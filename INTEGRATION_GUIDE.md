# Email-to-Telegram Integration Guide

## Overview

This integration enables automatic pickup code delivery via Telegram when InPost sends delivery emails. The system uses **tracking number as the only safe matching key** to prevent errors from delayed, duplicated, or reordered emails.

## Architecture

### 1️⃣ Shipment Creation Flow

When creating an InPost shipment, store:

```typescript
POST /api/tracking/numbers
{
  "tracking_number": "ABC123XYZ...",  // 24-char InPost tracking number
  "user_id": 123,                     // Your user ID
  "telegram_chat_id": 987654321,      // Telegram chat ID
  "email_used": "user@example.com",   // Email used for InPost
  "box_id": 5                         // Optional: box assignment
}
```

**Database Storage:**
- `tracking_number` (PRIMARY KEY, UNIQUE) ✅
- `user_id` ✅
- `telegram_chat_id` ✅
- `email_used` ✅
- `created_at` ✅

### 2️⃣ Email Processing Flow

**IMAP Email Scraper** (`backend/src/services/emailScraper.ts`):
- Runs every 5 minutes via cron scheduler
- Connects to IMAP (Gmail/other)
- Searches for unread emails from InPost
- Extracts: `tracking_number`, `pickup_code`, `locker_id`

**Extraction Patterns:**
- Tracking number: 24-character alphanumeric
- Pickup code: 6-digit code
- Locker ID: Alphanumeric locker identifier

### 3️⃣ Matching Logic (CRITICAL)

```typescript
// ✅ CORRECT: Match by tracking number ONLY
SELECT user_id, telegram_chat_id 
FROM tracking_numbers 
WHERE tracking_number = :tracking_number
AND user_id IS NOT NULL 
AND telegram_chat_id IS NOT NULL
```

**Safety Checks:**
- ✅ If exactly 1 row → Send code
- ❌ If 0 rows → Hold + log (no match found)
- ❌ If >1 rows → Critical error (should never happen - tracking_number is UNIQUE)

**Why tracking number is mandatory:**
- ✅ Unique identifier
- ✅ Stable (doesn't change)
- ✅ Present in every email
- ✅ Same value from label creation
- ❌ Time, locker, subject, email order can all be unreliable

### 4️⃣ Telegram Delivery

**Telegram Service** (`backend/src/services/telegramService.ts`):
- Sends pickup code to user's Telegram chat
- Only sends after perfect match
- Marks `pickup_code_sent_at` timestamp
- Handles errors gracefully

## Setup Instructions

### 1. Database Migration

Run the migration to add new columns:

```bash
cd backend
npm run migrate
```

This adds:
- `user_id`, `telegram_chat_id`, `email_used` (for shipment creation)
- `pickup_code`, `locker_id` (from email extraction)
- `pickup_code_sent_at`, `email_received_at` (timestamps)

### 2. Environment Variables

Add to `backend/.env`:

**Option 1: Multiple Email Accounts (Recommended)**

```env
# Multiple IMAP Email Accounts (JSON array)
IMAP_ACCOUNTS=[{"user":"email1@gmail.com","password":"app-password-1","host":"imap.gmail.com","port":993},{"user":"email2@gmail.com","password":"app-password-2","host":"imap.gmail.com","port":993}]

# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_ADMIN_CHAT_ID=your-admin-chat-id  # Optional: for error notifications
```

**Option 2: Single Email Account (Backward Compatible)**

```env
# Single IMAP Email Configuration
IMAP_USER=your-email@gmail.com
IMAP_PASSWORD=your-app-password
IMAP_HOST=imap.gmail.com
IMAP_PORT=993

# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_ADMIN_CHAT_ID=your-admin-chat-id  # Optional: for error notifications
```

**Gmail Setup (for each account):**
1. Enable 2FA
2. Generate App Password: https://myaccount.google.com/apppasswords
3. Use app password (not regular password) for each account's `password` field

**Multiple Accounts Benefits:**
- ✅ Process emails from multiple InPost accounts
- ✅ Higher email processing capacity
- ✅ Redundancy (if one account fails, others continue)
- ✅ Each account processed independently

**Example IMAP_ACCOUNTS JSON (formatted for readability):**
```json
[
  {
    "user": "inpost1@gmail.com",
    "password": "abcd efgh ijkl mnop",
    "host": "imap.gmail.com",
    "port": 993
  },
  {
    "user": "inpost2@gmail.com",
    "password": "wxyz abcd efgh ijkl",
    "host": "imap.gmail.com",
    "port": 993
  },
  {
    "user": "inpost3@outlook.com",
    "password": "password123",
    "host": "outlook.office365.com",
    "port": 993
  }
]
```

**Note:** In `.env` file, keep it on one line (JSON minified):
```env
IMAP_ACCOUNTS=[{"user":"inpost1@gmail.com","password":"abcd efgh ijkl mnop","host":"imap.gmail.com","port":993},{"user":"inpost2@gmail.com","password":"wxyz abcd efgh ijkl","host":"imap.gmail.com","port":993}]
```

### 3. Install Dependencies

```bash
cd backend
npm install imap mailparser
```

### 4. Create Telegram Bot

1. Message @BotFather on Telegram
2. `/newbot` → Follow instructions
3. Copy bot token to `TELEGRAM_BOT_TOKEN`
4. Users start chat with your bot
5. Get chat IDs from updates: `https://api.telegram.org/bot<TOKEN>/getUpdates`

## API Usage

### Create Shipment with User Info

```typescript
POST /api/tracking/numbers
Headers: { Authorization: Bearer <token> }
Body: {
  "tracking_number": "ABC123XYZ...",
  "user_id": 123,
  "telegram_chat_id": 987654321,
  "email_used": "user@example.com",
  "box_id": 5  // Optional
}
```

### Check Email Processing Status

Query tracking number to see if pickup code was received:

```sql
SELECT 
  tracking_number,
  pickup_code,
  locker_id,
  email_received_at,
  pickup_code_sent_at
FROM tracking_numbers
WHERE tracking_number = 'ABC123XYZ...';
```

## Email Patterns

The scraper looks for these patterns in InPost emails:

**Tracking Number:**
- `tracking number: ABC123XYZ...`
- `parcel number: ABC123XYZ...`
- `/tracking/ABC123XYZ...`
- Any 24-character alphanumeric string

**Pickup Code:**
- `pickup code: 123456`
- `code: 123456`
- `your code: 123456`
- Any 6-digit number

**Locker ID:**
- `locker: ABC123`
- `paczkomat: ABC123`
- `at locker ABC123`

## Error Handling

### No Match Found
- Email is logged but not processed
- Check logs: `[Email Scraper] No match found for tracking number: ...`
- Verify tracking number was created with user/telegram info

### Multiple Matches (Critical)
- Should never happen (tracking_number is UNIQUE)
- Email is NOT processed
- Logs critical error
- Requires database investigation

### Telegram Send Failure
- Email is processed and stored
- Pickup code NOT marked as sent
- Will retry on next email check
- Check Telegram bot token and chat ID

## Monitoring

### Logs to Watch

```
[Email Scraper] Found tracking number: ABC123...
[Email Scraper] Extracted - Tracking: ABC123..., Code: 123456, Locker: ABC123
[Email Scraper] ✅ Successfully processed email for ABC123...
[Telegram] ✅ Sent pickup code to chat 987654321 for ABC123...
```

### Database Queries

**Check pending pickup codes:**
```sql
SELECT tracking_number, pickup_code, email_received_at
FROM tracking_numbers
WHERE pickup_code IS NOT NULL
AND pickup_code_sent_at IS NULL;
```

**Check recent email processing:**
```sql
SELECT tracking_number, email_received_at, pickup_code_sent_at
FROM tracking_numbers
WHERE email_received_at IS NOT NULL
ORDER BY email_received_at DESC
LIMIT 20;
```

## Testing

### Manual Email Test

1. Create tracking number with user/telegram info
2. Send test email to IMAP inbox (from InPost or manually)
3. Wait for scheduler (5 minutes) or trigger manually:
   ```typescript
   import { checkInPostEmails } from './services/emailScraper';
   await checkInPostEmails();
   ```

### Test Telegram Bot

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/sendMessage" \
  -d "chat_id=YOUR_CHAT_ID" \
  -d "text=Test message"
```

## Security Notes

- ✅ Tracking number is UNIQUE constraint (prevents duplicates)
- ✅ Matching is exact (no fuzzy matching)
- ✅ Only sends after perfect match
- ✅ All operations logged
- ⚠️ Store IMAP credentials securely (use environment variables)
- ⚠️ Telegram bot token is sensitive (use environment variables)

## Troubleshooting

**Emails not being processed:**
- Check IMAP credentials for all accounts
- Verify `IMAP_ACCOUNTS` JSON format is valid (if using multiple accounts)
- Verify email search criteria (FROM address: 'inpost.pl')
- Check IMAP connection logs for each account
- Verify emails are unread
- Check if specific account is failing (logs show which account)

**Pickup codes not sending:**
- Verify Telegram bot token
- Check chat ID is correct
- Verify bot has permission to message user
- Check Telegram API rate limits

**No matches found:**
- Verify tracking number was created with user/telegram info
- Check tracking number format matches (24 chars, uppercase)
- Verify email extraction patterns match your InPost email format
