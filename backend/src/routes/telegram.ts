import express, { Request, Response } from 'express';
import axios from 'axios';
import { pool } from '../db/connection';

const router = express.Router();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

/**
 * Telegram webhook endpoint
 * Receives updates from Telegram when users send messages to the bot
 */
/**
 * Webhook endpoint (optional - polling is used by default)
 * If you set up a webhook, Telegram will send updates here
 */
router.post('/webhook', express.json(), async (req: Request, res: Response) => {
  try {
    const update = req.body;
    await processTelegramUpdate(update);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('[Telegram] Error processing webhook:', error);
    // Always return 200 to Telegram to avoid retries
    return res.status(200).json({ ok: false, error: 'Internal error' });
  }
});

/**
 * Helper function to send a message via Telegram API
 */
async function sendTelegramMessage(chatId: number | bigint, text: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('[Telegram] Bot token not configured');
    return false;
  }

  try {
    // Convert BigInt to string for serialization (Telegram API accepts string or number)
    const chatIdStr = typeof chatId === 'bigint' ? chatId.toString() : String(chatId);
    const response = await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
      chat_id: chatIdStr,
      text: text,
      parse_mode: 'HTML',
    });

    if (response.data.ok) {
      console.log(`[Telegram] ✅ Sent message to chat ${chatId}`);
      return true;
    } else {
      console.error(`[Telegram] Failed to send message:`, response.data);
      return false;
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(`[Telegram] Error sending message to ${chatId}:`, error.response?.data || error.message);
    } else {
      console.error(`[Telegram] Unknown error:`, error);
    }
    return false;
  }
}

/**
 * Helper function to get status emoji
 */
function getStatusEmoji(status: string): string {
  switch (status) {
    case 'not_scanned':
      return '🔴';
    case 'scanned':
      return '🟡';
    case 'delivered':
      return '🟢';
    default:
      return '⚪';
  }
}

/**
 * Process a Telegram update (message from user)
 * This function is used by both webhook and polling
 */
async function processTelegramUpdate(update: any): Promise<void> {
  if (!update.message) {
    return; // Ignore non-message updates
  }

  const message = update.message;
  const chatId = message.chat.id;
  const text = message.text || '';
  const command = text.toLowerCase().trim();

  console.log(`[Telegram] Received message from chat ${chatId}: ${text}`);

  // Handle /start command
  if (command === '/start' || command.startsWith('/start')) {
    const responseText = `👋 Welcome to InPost Tracking Bot!\n\n` +
      `Your Chat ID: <code>${chatId}</code>\n\n` +
      `Use this Chat ID when creating tracking numbers to receive pickup codes automatically.\n\n` +
      `Commands:\n` +
      `/start - Show this message\n` +
      `/chatid - Show your chat ID\n` +
      `/tracking - Show all your tracking numbers\n` +
      `/help - Show help message`;

    await sendTelegramMessage(chatId, responseText);
    return;
  }

  // Handle /chatid command
  if (command === '/chatid' || command.startsWith('/chatid')) {
    const responseText = `Your Chat ID: <code>${chatId}</code>\n\n` +
      `Use this ID when creating tracking numbers to receive pickup codes.`;

    await sendTelegramMessage(chatId, responseText);
    return;
  }

  // Handle /help command
  if (command === '/help' || command.startsWith('/help')) {
    const responseText = `📦 InPost Tracking Bot Help\n\n` +
      `This bot automatically sends pickup codes when your InPost parcels are ready.\n\n` +
      `To receive pickup codes:\n` +
      `1. Share your Chat ID with the system administrator\n` +
      `2. Your Chat ID: <code>${chatId}</code>\n` +
      `3. Tracking numbers will be linked to this Chat ID\n` +
      `4. When pickup codes arrive via email, you'll receive them here automatically\n\n` +
      `Commands:\n` +
      `/start - Welcome message\n` +
      `/chatid - Show your chat ID\n` +
      `/tracking - Show all your tracking numbers and pickup codes\n` +
      `/help - Show this help`;

    await sendTelegramMessage(chatId, responseText);
    return;
  }

  // Handle /tracking command - show user's tracking numbers and pickup codes
  if (command === '/tracking' || command.startsWith('/tracking')) {
    try {
      const result = await pool.query(
        `SELECT tracking_number, pickup_code, locker_id, current_status, 
                email_received_at, pickup_code_sent_at, created_at
         FROM tracking_numbers 
         WHERE telegram_chat_id = $1 
         ORDER BY created_at DESC
         LIMIT 20`,
        [chatId.toString()]
      );

      if (result.rows.length === 0) {
        const responseText = `📦 No tracking numbers found for your Chat ID.\n\n` +
          `Your Chat ID: <code>${chatId}</code>\n\n` +
          `Share this Chat ID with the administrator to link tracking numbers to your account.`;

        await sendTelegramMessage(chatId, responseText);
        return;
      }

      let responseText = `📦 Your Tracking Numbers (${result.rows.length})\n\n`;

      for (const row of result.rows) {
        responseText += `🔹 <b>${row.tracking_number}</b>\n`;
        responseText += `   Status: ${getStatusEmoji(row.current_status)} ${row.current_status}\n`;
        
        if (row.pickup_code) {
          responseText += `   ✅ Pickup Code: <code>${row.pickup_code}</code>\n`;
          if (row.locker_id) {
            responseText += `   📍 Locker: ${row.locker_id}\n`;
          }
          if (row.pickup_code_sent_at) {
            const sentDate = new Date(row.pickup_code_sent_at);
            responseText += `   📅 Sent: ${sentDate.toLocaleDateString()}\n`;
          }
        } else {
          responseText += `   ⏳ Pickup code not yet available\n`;
        }
        responseText += `\n`;
      }

      responseText += `\n💡 Tip: Pickup codes are sent automatically when your parcel is ready.`;

      await sendTelegramMessage(chatId, responseText);
      return;
    } catch (error) {
      console.error('[Telegram] Error fetching tracking numbers:', error);
      await sendTelegramMessage(chatId, '❌ Error fetching your tracking numbers. Please try again later.');
      return;
    }
  }

  // Check if message is a tracking number (24 characters alphanumeric)
  // Remove spaces and make case-insensitive for better matching
  const cleanedText = text.replace(/\s+/g, '').toUpperCase();
  const trackingNumberMatch = cleanedText.match(/([A-Z0-9]{24})/);
  if (trackingNumberMatch) {
    const trackingNumber = trackingNumberMatch[1];
    console.log(`[Telegram] Detected tracking number: ${trackingNumber}`);
    try {
      const result = await pool.query(
        `SELECT tracking_number, pickup_code, locker_id, current_status, 
                email_received_at, pickup_code_sent_at
         FROM tracking_numbers 
         WHERE tracking_number = $1 AND telegram_chat_id = $2`,
        [trackingNumber, chatId.toString()]
      );

      if (result.rows.length === 0) {
        await sendTelegramMessage(chatId, 
          `❌ Tracking number <code>${trackingNumber}</code> not found for your account.\n\n` +
          `Make sure this tracking number is linked to your Chat ID: <code>${chatId}</code>`
        );
        return;
      }

      const row = result.rows[0];
      let responseText = `📦 Tracking: <code>${row.tracking_number}</code>\n\n`;
      responseText += `Status: ${getStatusEmoji(row.current_status)} ${row.current_status}\n\n`;

      if (row.pickup_code) {
        responseText += `✅ <b>Pickup Code: <code>${row.pickup_code}</code></b>\n`;
        if (row.locker_id) {
          responseText += `📍 Locker: ${row.locker_id}\n`;
        }
        if (row.pickup_code_sent_at) {
          const sentDate = new Date(row.pickup_code_sent_at);
          responseText += `📅 Sent: ${sentDate.toLocaleDateString()}\n`;
        }
      } else {
        responseText += `⏳ Pickup code not yet available.\n`;
        responseText += `You'll receive it automatically when your parcel is ready.`;
      }

      await sendTelegramMessage(chatId, responseText);
      return;
    } catch (error) {
      console.error('[Telegram] Error fetching tracking number:', error);
      await sendTelegramMessage(chatId, '❌ Error fetching tracking information. Please try again later.');
      return;
    }
  }

  // Default response for any other message
  const responseText = `👋 Hello! I'm the InPost Tracking Bot.\n\n` +
    `Send /start to get your Chat ID and setup instructions.\n` +
    `Send /tracking to see all your tracking numbers.\n` +
    `Or send a tracking number to get its pickup code.\n\n` +
    `Your Chat ID: <code>${chatId}</code>`;

  await sendTelegramMessage(chatId, responseText);
}

/**
 * Start Telegram bot polling (long polling)
 * This checks for updates from Telegram every few seconds
 */
let lastUpdateId = 0;
let isPolling = false;

export async function startTelegramPolling(): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('[Telegram] Bot token not configured, skipping polling');
    return;
  }

  if (isPolling) {
    console.log('[Telegram] Polling already started');
    return;
  }

  isPolling = true;
  console.log('[Telegram] Starting long polling...');

  // Delete webhook first (if set) to enable polling
  try {
    await axios.post(`${TELEGRAM_API_URL}/deleteWebhook`, { drop_pending_updates: true });
    console.log('[Telegram] Webhook deleted, using polling mode');
  } catch (error) {
    console.warn('[Telegram] Could not delete webhook (may not be set):', error);
  }

  // Start polling loop
  const poll = async () => {
    if (!isPolling) return;

    try {
      const response = await axios.get(`${TELEGRAM_API_URL}/getUpdates`, {
        params: {
          offset: lastUpdateId + 1,
          timeout: 30, // Long polling: wait up to 30 seconds for updates
        },
        timeout: 35000, // Slightly longer than Telegram timeout
      });

      if (response.data.ok && response.data.result) {
        const updates = response.data.result;
        
        for (const update of updates) {
          await processTelegramUpdate(update);
          lastUpdateId = Math.max(lastUpdateId, update.update_id);
        }

        // Immediately poll again if we got updates (no delay)
        if (updates.length > 0) {
          setImmediate(poll);
        } else {
          // No updates, poll again after short delay
          setTimeout(poll, 1000);
        }
      } else {
        console.error('[Telegram] Error in getUpdates:', response.data);
        setTimeout(poll, 5000); // Wait 5 seconds on error
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('[Telegram] Polling error:', error.message);
      } else {
        console.error('[Telegram] Unknown polling error:', error);
      }
      setTimeout(poll, 5000); // Wait 5 seconds on error before retrying
    }
  };

  // Start polling
  poll();
}

export default router;
