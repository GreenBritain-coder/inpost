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
router.post('/webhook', express.json(), async (req: Request, res: Response) => {
  try {
    const update = req.body;
    
    // Telegram sends updates in this format
    if (!update.message) {
      return res.status(200).json({ ok: true }); // Acknowledge but ignore
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
      return res.status(200).json({ ok: true });
    }

    // Handle /chatid command
    if (command === '/chatid' || command.startsWith('/chatid')) {
      const responseText = `Your Chat ID: <code>${chatId}</code>\n\n` +
        `Use this ID when creating tracking numbers to receive pickup codes.`;

      await sendTelegramMessage(chatId, responseText);
      return res.status(200).json({ ok: true });
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
      return res.status(200).json({ ok: true });
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
          return res.status(200).json({ ok: true });
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
        return res.status(200).json({ ok: true });
      } catch (error) {
        console.error('[Telegram] Error fetching tracking numbers:', error);
        await sendTelegramMessage(chatId, '❌ Error fetching your tracking numbers. Please try again later.');
        return res.status(200).json({ ok: true });
      }
    }

    // Check if message is a tracking number (24 characters alphanumeric)
    const trackingNumberMatch = text.match(/\b([A-Z0-9]{24})\b/);
    if (trackingNumberMatch) {
      const trackingNumber = trackingNumberMatch[1];
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
          return res.status(200).json({ ok: true });
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
        return res.status(200).json({ ok: true });
      } catch (error) {
        console.error('[Telegram] Error fetching tracking number:', error);
        await sendTelegramMessage(chatId, '❌ Error fetching tracking information. Please try again later.');
        return res.status(200).json({ ok: true });
      }
    }

    // Default response for any other message
    const responseText = `👋 Hello! I'm the InPost Tracking Bot.\n\n` +
      `Send /start to get your Chat ID and setup instructions.\n` +
      `Send /tracking to see all your tracking numbers.\n` +
      `Or send a tracking number to get its pickup code.\n\n` +
      `Your Chat ID: <code>${chatId}</code>`;

    await sendTelegramMessage(chatId, responseText);
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
async function sendTelegramMessage(chatId: number, text: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('[Telegram] Bot token not configured');
    return false;
  }

  try {
    const response = await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
      chat_id: chatId,
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

export default router;
