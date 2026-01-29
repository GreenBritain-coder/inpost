import express, { Request, Response } from 'express';
import axios from 'axios';
import { pool } from '../db/connection';
import { setTelegramChatId, getUserIdByTelegramChatId, findUserByTelegramIdentity } from '../models/user';

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
/** Inline menu: My trackings + Help */
const INLINE_MENU = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '📦 My trackings', callback_data: 'tracking' }, { text: '🆘 Help', callback_data: 'help' }],
    ],
  },
};

async function sendTelegramMessage(chatId: number | bigint, text: string, withMenu = false): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('[Telegram] Bot token not configured');
    return false;
  }

  try {
    const chatIdStr = typeof chatId === 'bigint' ? chatId.toString() : String(chatId);
    const payload: any = {
      chat_id: chatIdStr,
      text: text,
      parse_mode: 'HTML',
    };
    if (withMenu) payload.reply_markup = INLINE_MENU.reply_markup;
    const response = await axios.post(`${TELEGRAM_API_URL}/sendMessage`, payload);

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

async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  try {
    await axios.post(`${TELEGRAM_API_URL}/answerCallbackQuery`, {
      callback_query_id: callbackQueryId,
      text: text ?? undefined,
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('[Telegram] answerCallbackQuery error:', error.message);
    }
  }
}

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

/** Telegram "from" object (id and optional username) for identity lookup */
interface TelegramFrom {
  id?: number;
  username?: string;
}

/**
 * Resolve backend user ID for this chat.
 * 1) By telegram_chat_id (already linked).
 * 2) By telegram_user_id / telegram_username (admin set in backend) — then link chat and return user.
 */
async function getLinkedUserId(
  chatId: number | bigint,
  from?: TelegramFrom | null
): Promise<number | null> {
  let userId = await getUserIdByTelegramChatId(chatId);
  if (userId != null) return userId;

  if (from?.id != null || from?.username) {
    const telegramUserId = from.id != null ? Number(from.id) : null;
    const telegramUsername = from.username ? `@${from.username}` : null;
    const matched = await findUserByTelegramIdentity(telegramUserId ?? null, telegramUsername ?? null);
    if (matched) {
      await setTelegramChatId(matched.id, chatId, telegramUserId ?? undefined);
      console.log(`[Telegram] Linked chat ${chatId} to user_id ${matched.id} (telegram_user_id=${telegramUserId})`);
      return matched.id;
    }
  }
  return null;
}

/** Build and send tracking list for a chat (used by /tracking and inline "My trackings" button) */
async function sendTrackingResponse(
  chatId: number | bigint,
  withMenu: boolean,
  from?: TelegramFrom | null
): Promise<void> {
  try {
    const linkedUserId = await getLinkedUserId(chatId, from);
    const result = await pool.query(
      `SELECT tracking_number, pickup_code, locker_id, current_status, 
              email_received_at, pickup_code_sent_at, created_at
       FROM tracking_numbers 
       WHERE telegram_chat_id = $1 
          OR (user_id = $2 AND $2 IS NOT NULL)
       ORDER BY created_at DESC
       LIMIT 20`,
      [chatId.toString(), linkedUserId ?? null]
    );

    if (result.rows.length === 0) {
      const text = linkedUserId == null
        ? `📦 No tracking numbers found for you.\n\n` +
          `Your admin must link your account: add your Telegram user ID (<code>${from?.id ?? '…'}</code>) to your user in the backend, then tap /tracking again.`
        : `📦 No tracking numbers assigned to you yet.\n\nYou're linked — you'll see trackings here once your admin adds them.`;
      await sendTelegramMessage(chatId, text, withMenu);
      return;
    }

    let text = `📦 Your Tracking Numbers (${result.rows.length})\n\n`;
    for (const row of result.rows) {
      text += `🔹 <b>${row.tracking_number}</b>\n`;
      text += `   Status: ${getStatusEmoji(row.current_status)} ${row.current_status}\n`;
      if (row.pickup_code) {
        text += `   ✅ Pickup Code: <code>${row.pickup_code}</code>\n`;
        if (row.locker_id) text += `   📍 Location: ${row.locker_id}\n`;
        if (row.pickup_code_sent_at) {
          text += `   📅 Sent: ${new Date(row.pickup_code_sent_at).toLocaleDateString()}\n`;
        }
      } else {
        text += `   ⏳ Pickup code not yet available\n`;
      }
      text += `\n`;
    }
    text += `💡 Tip: Pickup codes are sent automatically when your parcel is ready.`;
    await sendTelegramMessage(chatId, text, withMenu);
  } catch (error) {
    console.error('[Telegram] Error fetching tracking numbers:', error);
    await sendTelegramMessage(chatId, '❌ Error fetching your tracking numbers. Please try again later.', withMenu);
  }
}

/**
 * Process a Telegram update (message or inline button press)
 * This function is used by both webhook and polling
 */
async function processTelegramUpdate(update: any): Promise<void> {
  // Handle inline button press (e.g. "📦 My trackings" or "🆘 Help")
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat?.id;
    const data = cq.data;
    const callbackQueryId = cq.id;

    if (!chatId) return;

    console.log(`[Telegram] Callback from chat ${chatId}: ${data}`);
    await answerCallbackQuery(callbackQueryId);

    if (data === 'tracking') {
      const from = cq.from ? { id: cq.from.id, username: cq.from.username } : undefined;
      await sendTrackingResponse(chatId, true, from);
      return;
    }
    if (data === 'help') {
      const helpText = `📦 InPost Tracking Bot Help\n\n` +
        `This bot sends pickup codes when your InPost parcels are ready.\n\n` +
        `To see your trackings:\n` +
        `• Your admin adds your Telegram user ID to your account in the backend.\n` +
        `• Then tap <b>📦 My trackings</b> or send /tracking — the bot looks you up by your Telegram ID and shows your trackers.\n\n` +
        `You can also use a link from your admin: /start YOUR_USER_ID\n\n` +
        `Use the menu below to see your trackings or help.`;
      await sendTelegramMessage(chatId, helpText, true);
      return;
    }
    return;
  }

  if (!update.message) {
    return;
  }

  const message = update.message;
  const chatId = message.chat.id;
  const text = message.text || '';
  const command = text.toLowerCase().trim();

  console.log(`[Telegram] Received message from chat ${chatId}: ${text}`);

  // Handle /start — match by Telegram identity (from.id or @username) or by /start USER_ID
  if (command === '/start' || command.startsWith('/start')) {
    const parts = text.trim().split(/\s+/);
    const startArg = parts[1];
    const userIdFromPayload = startArg ? parseInt(startArg, 10) : NaN;

    // 1) Explicit /start USER_ID (link from admin)
    if (!isNaN(userIdFromPayload) && userIdFromPayload > 0) {
      const linked = await setTelegramChatId(userIdFromPayload, chatId);
      if (linked) {
        await sendTelegramMessage(chatId,
          `✅ You're linked!\n\nYour account is now connected. You'll receive pickup codes here when your parcels are ready.\n\nUse the menu below to see your trackings.`,
          true
        );
        console.log(`[Telegram] Linked user_id ${userIdFromPayload} to chat ${chatId}`);
      } else {
        await sendTelegramMessage(chatId, `❌ User ID <code>${userIdFromPayload}</code> not found. Ask your admin for the correct link.`, true);
      }
      return;
    }

    // 2) Automatic match by Telegram identity (user has telegram_user_id or telegram_username set in backend)
    const from = message.from;
    const telegramUserId = from?.id != null ? Number(from.id) : null;
    const telegramUsername = from?.username ? `@${from.username}` : null;

    const matchedUser = await findUserByTelegramIdentity(telegramUserId ?? null, telegramUsername ?? null);
    if (matchedUser) {
      const linked = await setTelegramChatId(matchedUser.id, chatId, telegramUserId ?? undefined);
      if (linked) {
        await sendTelegramMessage(chatId,
          `✅ You're linked!\n\nYour account is now connected. You'll receive pickup codes here when your parcels are ready.\n\nUse the menu below to see your trackings.`,
          true
        );
        console.log(`[Telegram] Auto-linked user_id ${matchedUser.id} to chat ${chatId} (Telegram: id=${telegramUserId} username=${telegramUsername})`);
      }
      return;
    }

    // 3) No match — welcome and point them to /tracking (works if admin linked them via CSV or dashboard)
    const responseText = `👋 Welcome to InPost Tracking Bot (@GB_Track_Bot)\n\n` +
      `Tap <b>📦 My trackings</b> or send /tracking to see your trackings.\n\n` +
      `If you don't see any, ask your admin for your personal link — they can link you when uploading trackings or from the dashboard.\n\n` +
      `Use the menu below:`;

    await sendTelegramMessage(chatId, responseText, true);
    return;
  }

  // Handle /help command
  if (command === '/help' || command.startsWith('/help')) {
    const responseText = `📦 InPost Tracking Bot Help\n\n` +
      `This bot sends pickup codes when your InPost parcels are ready.\n\n` +
      `To see your trackings:\n` +
      `• Your admin adds your Telegram user ID to your account in the backend.\n` +
      `• Then tap <b>📦 My trackings</b> or send /tracking — the bot looks you up by your Telegram ID and shows your trackers.\n\n` +
      `You can also use a link from your admin: /start YOUR_USER_ID\n\n` +
      `Use the menu below:`;

    await sendTelegramMessage(chatId, responseText, true);
    return;
  }

  // Handle /tracking command — resolve user by chat_id or by telegram_user_id (admin set in backend)
  if (command === '/tracking' || command.startsWith('/tracking')) {
    const from = message.from ? { id: message.from.id, username: message.from.username } : undefined;
    await sendTrackingResponse(chatId, true, from);
    return;
  }

  // Check if message is a tracking number (24 characters alphanumeric)
  const cleanedText = text.replace(/\s+/g, '').toUpperCase();
  const trackingNumberMatch = cleanedText.match(/([A-Z0-9]{24})/);
  if (trackingNumberMatch) {
    const trackingNumber = trackingNumberMatch[1];
    console.log(`[Telegram] Detected tracking number: ${trackingNumber}`);
    try {
      const from = message.from ? { id: message.from.id, username: message.from.username } : undefined;
      const linkedUserId = await getLinkedUserId(chatId, from);
      const result = await pool.query(
        `SELECT tracking_number, pickup_code, locker_id, current_status, 
                email_received_at, pickup_code_sent_at
         FROM tracking_numbers 
         WHERE tracking_number = $1 
           AND (telegram_chat_id = $2 OR (user_id = $3 AND $3 IS NOT NULL))`,
        [trackingNumber, chatId.toString(), linkedUserId ?? null]
      );

      if (result.rows.length === 0) {
        await sendTelegramMessage(chatId,
          linkedUserId == null
            ? `❌ Tracking number <code>${trackingNumber}</code> not found.\n\nYour admin must add your Telegram user ID to your user in the backend, then try again.`
            : `❌ Tracking number <code>${trackingNumber}</code> is not assigned to your account.`,
          true
        );
        return;
      }

      const row = result.rows[0];
      let responseText = `📦 Tracking: <code>${row.tracking_number}</code>\n\n`;
      responseText += `Status: ${getStatusEmoji(row.current_status)} ${row.current_status}\n\n`;

      if (row.pickup_code) {
        responseText += `✅ <b>Pickup Code: <code>${row.pickup_code}</code></b>\n`;
        if (row.locker_id) {
          responseText += `📍 Location: ${row.locker_id}\n`;
        }
        if (row.pickup_code_sent_at) {
          const sentDate = new Date(row.pickup_code_sent_at);
          responseText += `📅 Sent: ${sentDate.toLocaleDateString()}\n`;
        }
      } else {
        responseText += `⏳ Pickup code not yet available.\n`;
        responseText += `You'll receive it automatically when your parcel is ready.`;
      }

      await sendTelegramMessage(chatId, responseText, true);
      return;
    } catch (error) {
      console.error('[Telegram] Error fetching tracking number:', error);
      await sendTelegramMessage(chatId, '❌ Error fetching tracking information. Please try again later.', true);
      return;
    }
  }

  // Default response for any other message
  const responseText = `👋 Hello! I'm the InPost Tracking Bot (@GB_Track_Bot).\n\n` +
    `Send /start to link your account, or use the menu below:`;

  await sendTelegramMessage(chatId, responseText, true);
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
