import Imap from 'imap';
import { simpleParser } from 'mailparser';
import { pool } from '../db/connection';

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
 * InPost emails typically contain tracking numbers in format: 24 characters (alphanumeric)
 */
function extractTrackingNumber(text: string): string | null {
  // InPost tracking numbers are typically 24 characters, alphanumeric
  // Common patterns in emails:
  // - "Tracking number: ABC123XYZ..."
  // - "Parcel number: 123456789012345678901234"
  // - In URLs: /tracking/ABC123XYZ...
  
  const patterns = [
    /tracking[_\s]*number[:\s]*([A-Z0-9]{24})/i,
    /parcel[_\s]*number[:\s]*([A-Z0-9]{24})/i,
    /([A-Z0-9]{24})/g, // Generic 24-char alphanumeric
    /\/tracking\/([A-Z0-9]{24})/i,
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
 * Pickup codes are typically 6 digits
 */
function extractPickupCode(text: string): string | null {
  // InPost pickup codes are 6 digits
  // Common patterns:
  // - "Pickup code: 123456"
  // - "Code: 123456"
  // - "Your code: 123456"
  
  const patterns = [
    /pickup[_\s]*code[:\s]*(\d{6})/i,
    /code[:\s]*(\d{6})/i,
    /your[_\s]*code[:\s]*(\d{6})/i,
    /\b(\d{6})\b/g, // Generic 6-digit code
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
 * Extract locker ID from InPost email
 * Locker IDs are typically alphanumeric codes
 */
function extractLockerId(text: string): string | null {
  // InPost locker IDs vary in format
  // Common patterns:
  // - "Locker: ABC123"
  // - "Paczkomat: ABC123"
  // - "At locker ABC123"
  
  const patterns = [
    /locker[:\s]*([A-Z0-9]+)/i,
    /paczkomat[:\s]*([A-Z0-9]+)/i,
    /at[_\s]*locker[_\s]*([A-Z0-9]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].toUpperCase();
    }
  }

  return null;
}

/**
 * Match tracking number to shipment and return user info
 * Returns exactly 1 match, or null if no match or multiple matches
 */
async function matchTrackingNumber(trackingNumber: string): Promise<{
  user_id: number;
  telegram_chat_id: bigint;
  tracking_id: number;
} | null> {
  const result = await pool.query(
    `SELECT id, user_id, telegram_chat_id 
     FROM tracking_numbers 
     WHERE tracking_number = $1 
     AND user_id IS NOT NULL 
     AND telegram_chat_id IS NOT NULL`,
    [trackingNumber]
  );

  if (result.rows.length === 0) {
    console.warn(`[Email Scraper] No match found for tracking number: ${trackingNumber}`);
    return null;
  }

  if (result.rows.length > 1) {
    console.error(`[Email Scraper] CRITICAL: Multiple matches for tracking number: ${trackingNumber} (${result.rows.length} rows)`);
    // Log all matches for investigation
    console.error('Matches:', result.rows);
    return null; // Don't send code if ambiguous
  }

  return {
    tracking_id: result.rows[0].id,
    user_id: result.rows[0].user_id,
    telegram_chat_id: BigInt(result.rows[0].telegram_chat_id),
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
 * Process a single email message
 * @param emailText - Plain text content of email
 * @param emailHtml - HTML content of email
 * @param emailAccount - Email account that received this email (for logging)
 */
async function processEmail(emailText: string, emailHtml: string, emailAccount?: string): Promise<void> {
  const fullText = emailText + ' ' + emailHtml.replace(/<[^>]*>/g, ' '); // Combine text and HTML
  
  const trackingNumber = extractTrackingNumber(fullText);
  if (!trackingNumber) {
    console.log(`[Email Scraper]${emailAccount ? ` [${emailAccount}]` : ''} No tracking number found in email`);
    return;
  }

  console.log(`[Email Scraper]${emailAccount ? ` [${emailAccount}]` : ''} Found tracking number: ${trackingNumber}`);

  // Match tracking number to shipment
  const match = await matchTrackingNumber(trackingNumber);
  if (!match) {
    console.warn(`[Email Scraper] Cannot send code - no valid match for ${trackingNumber}`);
    return;
  }

  // Extract pickup code and locker ID
  const pickupCode = extractPickupCode(fullText);
  const lockerId = extractLockerId(fullText);

  if (!pickupCode) {
    console.warn(`[Email Scraper] No pickup code found for tracking number: ${trackingNumber}`);
    return;
  }

  console.log(`[Email Scraper] Extracted - Tracking: ${trackingNumber}, Code: ${pickupCode}, Locker: ${lockerId || 'N/A'}`);

  // Update database with pickup code
  await updateTrackingWithPickupCode(match.tracking_id, pickupCode, lockerId);

  // Send to Telegram
  const { sendPickupCodeToTelegram } = await import('./telegramService');
  const sent = await sendPickupCodeToTelegram(
    match.telegram_chat_id, 
    trackingNumber, 
    pickupCode, 
    lockerId
  );
  
  if (!sent) {
    console.error(`[Email Scraper] Failed to send Telegram message for ${trackingNumber}`);
    return; // Don't mark as sent if Telegram failed
  }
  
  // Mark as sent
  await markPickupCodeSent(match.tracking_id);

  console.log(`[Email Scraper] ✅ Successfully processed email for ${trackingNumber}`);
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
        // Search for unread emails OR emails from last 24 hours (to catch emails that were already read)
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        
        // IMAP search: unread emails from InPost OR emails from last 24 hours from InPost
        // Use separate searches and combine, or use a more flexible approach
        // For node-imap, we need to structure the OR correctly
        imap.search([
          'UNSEEN',
          ['OR', 
            ['FROM', 'inpost.pl'], 
            ['FROM', 'inpost.co.uk'],
            ['FROM', 'inpost@inpost.co.uk']
          ]
        ], async (err, results) => {
          if (err) {
            console.error(`[Email Scraper] Search error for ${account.user}:`, err);
            reject(err);
            return;
          }

          // If no unread emails found, also check emails from last 24 hours
          if (!results || results.length === 0) {
            console.log(`[Email Scraper] No unread emails found for ${account.user}, checking last 24 hours...`);
            imap.search([
              ['SINCE', yesterday],
              ['OR', 
                ['FROM', 'inpost.pl'], 
                ['FROM', 'inpost.co.uk'],
                ['FROM', 'inpost@inpost.co.uk']
              ]
            ], async (err2, results2) => {
              if (err2) {
                console.error(`[Email Scraper] Search error (24h) for ${account.user}:`, err2);
                imap.end();
                resolve();
                return;
              }
              
              if (!results2 || results2.length === 0) {
                console.log(`[Email Scraper] No new emails found for ${account.user}`);
                imap.end();
                resolve();
                return;
              }

              console.log(`[Email Scraper] Found ${results2.length} email(s) from last 24 hours for ${account.user}`);
              await processEmails(imap, results2, account.user);
              imap.end();
              resolve();
            });
            return;
          }

          console.log(`[Email Scraper] Found ${results.length} new email(s) for ${account.user}`);
          await processEmails(imap, results, account.user);
          imap.end();
          resolve();
        });
          if (err) {
            console.error(`[Email Scraper] Search error for ${account.user}:`, err);
            reject(err);
            return;
          }

          if (!results || results.length === 0) {
            console.log(`[Email Scraper] No new emails found for ${account.user}`);
            imap.end();
            resolve();
            return;
          }

          console.log(`[Email Scraper] Found ${results.length} new email(s) for ${account.user}`);

          const fetch = imap.fetch(results, { bodies: '' });

          fetch.on('message', (msg, seqno) => {
            msg.on('body', async (stream) => {
              const parsed = await simpleParser(stream);
              const emailText = parsed.text || '';
              const emailHtml = parsed.html || '';

              try {
                await processEmail(emailText, emailHtml, account.user);
              } catch (error) {
                console.error(`[Email Scraper] Error processing email ${seqno} from ${account.user}:`, error);
              }
            });
          });

          fetch.once('end', () => {
            console.log(`[Email Scraper] Finished processing emails for ${account.user}`);
            imap.end();
            resolve();
          });
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
  extractLockerId,
  matchTrackingNumber,
};
