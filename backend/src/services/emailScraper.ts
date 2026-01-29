import Imap from 'imap';
import { simpleParser } from 'mailparser';
import { pool } from '../db/connection';
import { createTrackingNumber } from '../models/tracking';

/**
 * Parse IMAP account configuration from environment variables
 * Supports multiple formats:
 * 1. Single account: IMAP_USER, IMAP_PASSWORD, etc.
 * 2. Multiple accounts: IMAP_ACCOUNTS (JSON array)
 * 
 * Example JSON format:
 * [
 *   {"user": "email1@gmail.com", "password": "pass1", "host": "imap.gmail.com", "port": 993},
 *   {"user": "email2@gmail.com", "password": "pass2", "host": "imap.gmail.com", "port": 993}
 * ]
 */
interface ImapAccountConfig {
  user: string;
  password: string;
  host: string;
  port: number;
  tls?: boolean;
  tlsOptions?: { rejectUnauthorized: boolean };
}

function getImapAccounts(): ImapAccountConfig[] {
  // Try JSON array format first (for multiple accounts)
  const accountsJson = process.env.IMAP_ACCOUNTS;
  if (accountsJson) {
    try {
      // Remove any surrounding quotes that Coolify might add
      let cleanedJson = accountsJson.trim();
      
      // Debug: Log first few characters with their char codes
      console.log('[Email Scraper] IMAP_ACCOUNTS first 10 chars:', cleanedJson.substring(0, 10));
      console.log('[Email Scraper] IMAP_ACCOUNTS char codes (first 10):', 
        Array.from(cleanedJson.substring(0, 10)).map(c => `${c}(${c.charCodeAt(0)})`).join(' '));
      
      // Remove surrounding quotes (single or double)
      if ((cleanedJson.startsWith('"') && cleanedJson.endsWith('"')) ||
          (cleanedJson.startsWith("'") && cleanedJson.endsWith("'"))) {
        cleanedJson = cleanedJson.slice(1, -1);
        console.log('[Email Scraper] Removed surrounding quotes');
      }
      
      // Handle escaped quotes (if Coolify escaped them)
      cleanedJson = cleanedJson.replace(/\\"/g, '"').replace(/\\'/g, "'");
      
      // Try parsing
      const accounts = JSON.parse(cleanedJson) as ImapAccountConfig[];
      if (!Array.isArray(accounts)) {
        throw new Error('IMAP_ACCOUNTS must be a JSON array');
      }
      
      console.log(`[Email Scraper] Successfully parsed ${accounts.length} IMAP account(s)`);
      
      return accounts.map(acc => ({
        user: acc.user,
        password: acc.password,
        host: acc.host || 'imap.gmail.com',
        port: acc.port || 993,
        tls: acc.tls !== false,
        tlsOptions: { rejectUnauthorized: false },
      }));
    } catch (error) {
      console.error('[Email Scraper] Failed to parse IMAP_ACCOUNTS JSON:', error);
      console.error('[Email Scraper] Raw IMAP_ACCOUNTS value (first 200 chars):', accountsJson.substring(0, 200));
      console.error('[Email Scraper] Full IMAP_ACCOUNTS value length:', accountsJson.length);
      console.error('[Email Scraper] Full IMAP_ACCOUNTS value:', accountsJson);
    }
  }

  // Fallback to single account format (backward compatible)
  const singleUser = process.env.IMAP_USER;
  const singlePassword = process.env.IMAP_PASSWORD;
  if (singleUser && singlePassword) {
    return [{
      user: singleUser,
      password: singlePassword,
      host: process.env.IMAP_HOST || 'imap.gmail.com',
      port: parseInt(process.env.IMAP_PORT || '993'),
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    }];
  }

  return [];
}

/**
 * Extract tracking number from InPost email
 * InPost emails contain tracking numbers in various formats:
 * - UK format: 15-18 characters (e.g., JJD0002233573349014, MD000000867865453)
 * - EU format: 24 characters (alphanumeric)
 */
function extractTrackingNumber(text: string): string | null {
  // InPost tracking numbers vary by region:
  // - UK: 15-18 characters (MD/JJD prefix common)
  // - EU: 24 characters
  // Common patterns in emails:
  // - "Tracking number: ABC123XYZ..."
  // - "PARCEL NO. JJD0002233573349014" (UK format)
  // - "Parcel number MD000000867865453"
  // - In URLs: /tracking/ABC123XYZ...
  
  const patterns = [
    /parcel[_\s.]*no\.?\s*([A-Z]{2,3}[0-9]{12,21})/i, // "PARCEL NO. JJD0002233573349014" (UK format)
    /parcel[_\s.]*number[:\s]*([A-Z]{2,3}[0-9]{12,21})/i, // "Parcel number MD000000867865453"
    /tracking[_\s.]*number[:\s]*([A-Z0-9]{12,24})/i, // "Tracking number: ..."
    /\/tracking\/([A-Z0-9]{12,24})/i, // URL format
    /\b([A-Z]{2,3}[0-9]{12,21})\b/g, // Generic: 2-3 letters + 12-21 digits (covers UK format)
    /\b([A-Z0-9]{20,24})\b/g, // Generic: 20-24 chars (covers EU format, avoids false positives)
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].toUpperCase().replace(/\s+/g, '');
    }
  }

  return null;
}

/**
 * Extract pickup code from InPost email
 * Pickup codes are typically 6 digits (UK: "COLLECTION CODE 247089")
 */
function extractPickupCode(text: string): string | null {
  // InPost pickup codes are 6 digits
  // Common patterns:
  // - "COLLECTION CODE 247089" (UK ready-to-collect emails)
  // - "Pickup code: 123456"
  // - "Code: 123456"
  // - "Your code: 123456"
  
  const patterns = [
    /collection[_\s]*code[:\s]*(\d{6})/i,
    /pickup[_\s]*code[:\s]*(\d{6})/i,
    /code[:\s]*(\d{6})/i,
    /your[_\s]*code[:\s]*(\d{6})/i,
    /\b(\d{6})\b/g, // Generic 6-digit code (last resort)
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Extract send code from InPost email (for drop-off)
 * Send codes are typically 9 digits, may have spaces
 * Format: "344 924 512" or "344924512"
 */
function extractSendCode(text: string): string | null {
  // InPost send codes are 9 digits, possibly with spaces
  // Common patterns:
  // - "Enter this code instead344 924 512"
  // - "code instead 344 924 512"
  // - "QR code not working?Enter this code instead344 924 512"
  
  const patterns = [
    /code\s*instead\s*(\d{3}\s*\d{3}\s*\d{3})/i,
    /send[_\s]*code[:\s]*(\d{3}\s*\d{3}\s*\d{3})/i,
    /drop[_\s]*off[_\s]*code[:\s]*(\d{3}\s*\d{3}\s*\d{3})/i,
    /(\d{3}\s+\d{3}\s+\d{3})/g, // Generic 9-digit code with spaces
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      // Remove spaces for consistent storage
      return match[1].replace(/\s+/g, '');
    }
  }

  return null;
}

/**
 * Extract locker/shop location from InPost email
 * UK shop emails: "Delivered to: INPOST SHOP InPost shop - Co-operative NR13 5LP Norwich"
 */
function extractLockerId(text: string): string | null {
  // UK "ready to collect" emails: "InPost shop - Co-operative NR13 5LP Norwich"
  // Pattern: "InPost shop - " followed by shop name, postcode, and city
  const shopMatch = text.match(/inpost\s+shop\s*-\s*([A-Za-z0-9\s\-.,()]+?)(?=\s+(?:Opening|Recipient|What's|Get|PHONE|Collect by|No need)|\s*$)/i);
  if (shopMatch && shopMatch[1]?.trim()) {
    return shopMatch[1].trim();
  }
  
  // "Delivered to: INPOST SHOP InPost shop - ..." format
  const deliveredShopMatch = text.match(/delivered\s+to:?\s+inpost\s+shop\s+inpost\s+shop\s*-\s*([A-Za-z0-9\s\-.,()]+?)(?=\s+(?:Opening|Recipient|What's|Get)|\s*$)/i);
  if (deliveredShopMatch && deliveredShopMatch[1]?.trim()) {
    return deliveredShopMatch[1].trim();
  }
  
  // Locker IDs (alphanumeric codes like "WAR01M", "BIR123")
  const patterns = [
    /locker[:\s]+([A-Z0-9]{5,8})/i,
    /paczkomat[:\s]+([A-Z0-9]{5,8})/i,
    /at[_\s]+locker[_\s]+([A-Z0-9]{5,8})/i,
  ];
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m?.[1]) return m[1].toUpperCase();
  }
  
  return null;
}

/**
 * Extract recipient name from InPost email
 * Format: "TO: Name" or "TO:Name"
 */
function extractRecipientName(text: string): string | null {
  // InPost emails show recipient as "TO: Name"
  // Common patterns:
  // - "TO: Katie Harvey"
  // - "TO:John Doe"
  
  const patterns = [
    /TO:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,  // "TO: Katie Harvey"
    /recipient[:\s]*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,  // "Recipient: Katie Harvey"
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Match tracking number to shipment and return row info.
 * Finds by tracking_number only so we can store pickup/send codes even when
 * the parcel was added without user/Telegram. Telegram is only sent when telegram_chat_id is set.
 * Returns exactly 1 match, or null if no match or multiple matches.
 */
async function matchTrackingNumber(trackingNumber: string): Promise<{
  user_id: number | null;
  telegram_chat_id: bigint | null;
  tracking_id: number;
  pickup_code_sent_at: Date | null;
  send_code_sent_at: Date | null;
} | null> {
  const result = await pool.query(
    `SELECT id, user_id, telegram_chat_id, pickup_code_sent_at, send_code_sent_at
     FROM tracking_numbers 
     WHERE tracking_number = $1`,
    [trackingNumber]
  );

  if (result.rows.length === 0) {
    console.warn(`[Email Scraper] No match found for tracking number: ${trackingNumber}`);
    return null;
  }

  if (result.rows.length > 1) {
    console.error(`[Email Scraper] CRITICAL: Multiple matches for tracking number: ${trackingNumber} (${result.rows.length} rows)`);
    console.error('Matches:', result.rows);
    return null;
  }

  const row = result.rows[0];
  return {
    tracking_id: row.id,
    user_id: row.user_id,
    telegram_chat_id: row.telegram_chat_id != null ? BigInt(row.telegram_chat_id) : null,
    pickup_code_sent_at: row.pickup_code_sent_at,
    send_code_sent_at: row.send_code_sent_at,
  };
}

/**
 * Update tracking number with pickup code and locker info
 */
async function updateTrackingWithPickupCode(
  trackingId: number,
  pickupCode: string,
  lockerId: string | null
): Promise<void> {
  await pool.query(
    `UPDATE tracking_numbers 
     SET pickup_code = $1, 
         locker_id = $2,
         email_received_at = CURRENT_TIMESTAMP
     WHERE id = $3`,
    [pickupCode, lockerId, trackingId]
  );
}

/**
 * Mark pickup code as sent
 */
async function markPickupCodeSent(trackingId: number): Promise<void> {
  await pool.query(
    `UPDATE tracking_numbers 
     SET pickup_code_sent_at = CURRENT_TIMESTAMP 
     WHERE id = $1`,
    [trackingId]
  );
}

/**
 * Update tracking number with send code (for drop-off)
 */
async function updateTrackingWithSendCode(
  trackingId: number,
  sendCode: string,
  recipientName: string | null
): Promise<void> {
  await pool.query(
    `UPDATE tracking_numbers 
     SET send_code = $1,
         recipient_name = $2,
         send_email_received_at = CURRENT_TIMESTAMP
     WHERE id = $3`,
    [sendCode, recipientName, trackingId]
  );
}

/**
 * Mark send code as sent
 */
async function markSendCodeSent(trackingId: number): Promise<void> {
  await pool.query(
    `UPDATE tracking_numbers 
     SET send_code_sent_at = CURRENT_TIMESTAMP 
     WHERE id = $1`,
    [trackingId]
  );
}

/**
 * Process a single email message
 * @param emailText - Plain text content of email
 * @param emailHtml - HTML content of email
 * @param emailSubject - Email subject line (for logging)
 * @param emailAccount - Email account that received this email (for logging)
 * @returns true if email was successfully processed, false otherwise
 */
async function processEmail(emailText: string, emailHtml: string, emailSubject: string = '', emailAccount?: string): Promise<boolean> {
  // Better HTML text extraction: remove style/script tags first, then strip all HTML
  let cleanHtml = emailHtml
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove style tags
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove script tags
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '') // Remove head section
    .replace(/<[^>]*>/g, ' ') // Strip remaining HTML tags
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
  
  const fullText = emailText + ' ' + cleanHtml; // Combine text and cleaned HTML
  
  // Debug logging to see email content
  console.log(`[Email Scraper]${emailAccount ? ` [${emailAccount}]` : ''} Processing email with subject: "${emailSubject}"`);
  console.log(`[Email Scraper] Email text length: ${emailText.length}, HTML length: ${emailHtml.length}`);
  console.log(`[Email Scraper] First 300 chars of cleaned content: ${fullText.substring(0, 300)}`);
  
  const trackingNumber = extractTrackingNumber(fullText);
  if (!trackingNumber) {
    console.log(`[Email Scraper]${emailAccount ? ` [${emailAccount}]` : ''} No tracking number found in email`);
    console.log(`[Email Scraper] Content sample (chars 500-1000): ${fullText.substring(500, 1000)}`);
    console.log(`[Email Scraper] Content sample (chars 1000-1500): ${fullText.substring(1000, 1500)}`);
    return false;
  }

  console.log(`[Email Scraper]${emailAccount ? ` [${emailAccount}]` : ''} Found tracking number: ${trackingNumber}`);

  // Extract codes first so we know if we should auto-create a row when missing
  const pickupCode = extractPickupCode(fullText);
  const sendCode = extractSendCode(fullText);
  const lockerId = extractLockerId(fullText);
  const recipientName = extractRecipientName(fullText);

  // Match tracking number to shipment (by tracking_number only; user/Telegram optional)
  let match = await matchTrackingNumber(trackingNumber);

  // If no row exists but we have a code from the email, create a tracking row so we store the code
  if (!match && (pickupCode || sendCode) && emailAccount) {
    console.log(`[Email Scraper] No DB row for ${trackingNumber}; creating from email (email_used=${emailAccount})`);
    await createTrackingNumber(trackingNumber, null, null, null, emailAccount);
    match = await matchTrackingNumber(trackingNumber);
  }

  if (!match) {
    console.warn(`[Email Scraper] Cannot store code - no match for ${trackingNumber}`);
    return false;
  }

  let processedSomething = false;

  // Process send code (drop-off email)
  // NOTE: Send codes are ADMIN-ONLY and should NOT be sent to users via Telegram
  // They are stored in the database for admin viewing only
  if (sendCode) {
    console.log(`[Email Scraper] Found SEND code for ${trackingNumber}: ${sendCode}`);
    if (recipientName) {
      console.log(`[Email Scraper] Found recipient name: ${recipientName}`);
    }
    
    if (match.send_code_sent_at) {
      console.log(`[Email Scraper] Send code already stored for ${trackingNumber} at ${match.send_code_sent_at}, skipping duplicate`);
    } else {
      await updateTrackingWithSendCode(match.tracking_id, sendCode, recipientName);
      await markSendCodeSent(match.tracking_id);
      console.log(`[Email Scraper] ✅ Stored SEND code for ${trackingNumber} in database (admin-only, NOT sent to Telegram)`);
      processedSomething = true;
    }
  }

  // Process pickup code (collection email)
  if (pickupCode) {
    console.log(`[Email Scraper] Found PICKUP code for ${trackingNumber}: ${pickupCode}`);
    if (lockerId) {
      console.log(`[Email Scraper] Found pickup location for ${trackingNumber}: ${lockerId}`);
    } else {
      console.log(`[Email Scraper] No pickup location found for ${trackingNumber}`);
    }
    
    if (match.pickup_code_sent_at) {
      console.log(`[Email Scraper] Pickup code already sent for ${trackingNumber} at ${match.pickup_code_sent_at}, skipping duplicate`);
    } else {
      await updateTrackingWithPickupCode(match.tracking_id, pickupCode, lockerId);

      if (match.telegram_chat_id != null) {
        const { sendPickupCodeToTelegram } = await import('./telegramService');
        const sent = await sendPickupCodeToTelegram(
          match.telegram_chat_id,
          trackingNumber,
          pickupCode,
          lockerId
        );
        if (sent) {
          await markPickupCodeSent(match.tracking_id);
          console.log(`[Email Scraper] ✅ Successfully processed PICKUP code for ${trackingNumber} (Telegram sent)`);
          processedSomething = true;
        } else {
          console.error(`[Email Scraper] Failed to send Telegram message for pickup code ${trackingNumber}`);
        }
      } else {
        await markPickupCodeSent(match.tracking_id);
        console.log(`[Email Scraper] ✅ Stored PICKUP code for ${trackingNumber} (no Telegram chat linked)`);
        processedSomething = true;
      }
    }
  }

  // If no codes found at all
  if (!sendCode && !pickupCode) {
    console.warn(`[Email Scraper] No send code or pickup code found for tracking number: ${trackingNumber}`);
    return false;
  }

  // If we already sent codes before, mark as processed (don't leave unread)
  if (match.send_code_sent_at || match.pickup_code_sent_at) {
    return true;
  }

  return processedSomething;
}

/**
 * Process emails from IMAP search results
 * Marks emails as read after successful processing
 */
async function processEmails(imap: Imap, results: number[], emailAccount: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const fetch = imap.fetch(results, { bodies: '' });
    const processedUids: number[] = [];

    fetch.on('message', (msg, seqno) => {
      let uid: number | null = null;
      
      msg.once('attributes', (attrs) => {
        uid = attrs.uid;
      });

      msg.on('body', async (stream) => {
        const parsed = await simpleParser(stream);
        const emailText = parsed.text || '';
        const emailHtml = parsed.html || '';
        const emailSubject = parsed.subject || '';
        const emailFrom = parsed.from?.text || 'unknown';
        const emailDate = parsed.date?.toISOString() || 'unknown';

        console.log(`[Email Scraper] [${emailAccount}] Processing email #${seqno}: Subject="${emailSubject}", From="${emailFrom}", Date="${emailDate}"`);

        try {
          const success = await processEmail(emailText, emailHtml, emailSubject, emailAccount);
          // Mark as read if successfully processed (or already processed before)
          if (success && uid) {
            processedUids.push(uid);
          }
        } catch (error) {
          console.error(`[Email Scraper] Error processing email ${seqno} from ${emailAccount}:`, error);
        }
      });
    });

    fetch.once('end', () => {
      // Mark all successfully processed emails as read
      if (processedUids.length > 0) {
        imap.addFlags(processedUids, '\\Seen', (err) => {
          if (err) {
            console.error(`[Email Scraper] Failed to mark ${processedUids.length} email(s) as read:`, err);
          } else {
            console.log(`[Email Scraper] Marked ${processedUids.length} email(s) as read`);
          }
          // Resolve after flags are set (or failed) - ensures connection stays open until flags are saved
          console.log(`[Email Scraper] Finished processing emails for ${emailAccount}`);
          resolve();
        });
      } else {
        // No emails to mark as read, resolve immediately
        console.log(`[Email Scraper] Finished processing emails for ${emailAccount}`);
        resolve();
      }
    });

    fetch.once('error', (err) => {
      console.error(`[Email Scraper] Fetch error for ${emailAccount}:`, err);
      reject(err);
    });
  });
}

/**
 * Connect to a single IMAP account and process new emails
 */
async function checkImapAccount(account: ImapAccountConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    const imap = new Imap(account);

    imap.once('ready', () => {
      console.log(`[Email Scraper] Connected to IMAP for ${account.user}`);
      
      imap.openBox('INBOX', false, (err, box) => {
        if (err) {
          console.error(`[Email Scraper] Failed to open INBOX for ${account.user}:`, err);
          reject(err);
          return;
        }

        // Search for emails from InPost
        // Support multiple InPost email domains: inpost.pl, inpost.co.uk, etc.
        // Search ALL emails from last 7 days (don't rely on UNSEEN flag which Gmail sometimes delays)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        
        console.log(`[Email Scraper] Searching for ALL InPost emails from last 7 days for ${account.user}...`);
        
        // IMAP search: all emails from InPost in the last 7 days (ignore UNSEEN status)
        // IMAP OR only supports exactly 2 arguments, so nest them
        imap.search([
          ['SINCE', sevenDaysAgo],
          ['OR', 
            ['FROM', 'inpost.pl'], 
            ['OR', 
              ['FROM', 'inpost.co.uk'],
              ['FROM', 'inpost@inpost.co.uk']
            ]
          ]
        ], async (err, results) => {
          if (err) {
            console.error(`[Email Scraper] Search error for ${account.user}:`, err);
            imap.end();
            reject(err);
            return;
          }

          if (!results || results.length === 0) {
            console.log(`[Email Scraper] No InPost emails found from last 7 days for ${account.user}`);
            imap.end();
            resolve();
            return;
          }

          console.log(`[Email Scraper] Found ${results.length} InPost email(s) from last 7 days for ${account.user}`);
          try {
            await processEmails(imap, results, account.user);
          } catch (error) {
            console.error(`[Email Scraper] Error processing emails for ${account.user}:`, error);
          }
          imap.end();
          resolve();
        });
      });
    });

    imap.once('error', (err) => {
      console.error(`[Email Scraper] IMAP error for ${account.user}:`, err);
      reject(err);
    });

    imap.connect();
  });
}

/**
 * Connect to all configured IMAP accounts and process new emails
 * Supports multiple email accounts for scraping InPost emails
 */
export async function checkInPostEmails(): Promise<void> {
  const accounts = getImapAccounts();
  
  if (accounts.length === 0) {
    console.warn('[Email Scraper] No IMAP accounts configured, skipping email check');
    console.warn('[Email Scraper] Configure IMAP_ACCOUNTS (JSON) or IMAP_USER/IMAP_PASSWORD (single account)');
    return;
  }

  console.log(`[Email Scraper] Checking ${accounts.length} email account(s)...`);

  // Process all accounts sequentially to avoid overwhelming the system
  // Each account is processed independently, so one failure doesn't stop others
  const results = await Promise.allSettled(
    accounts.map(account => checkImapAccount(account))
  );

  // Log summary
  const successful = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  
  console.log(`[Email Scraper] Completed: ${successful} account(s) successful, ${failed} account(s) failed`);
  
  // Log any failures
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`[Email Scraper] Account ${accounts[index].user} failed:`, result.reason);
    }
  });
}

export {
  extractTrackingNumber,
  extractPickupCode,
  extractSendCode,
  extractLockerId,
  extractRecipientName,
  matchTrackingNumber,
};
