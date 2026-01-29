import axios from 'axios';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

/**
 * Send pickup code to user via Telegram
 */
export async function sendPickupCodeToTelegram(
  chatId: bigint | number,
  trackingNumber: string,
  pickupCode: string,
  lockerId: string | null
): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('[Telegram] Bot token not configured');
    return false;
  }

  const message = `📦 Your InPost parcel is ready for pickup!\n\n` +
    `Tracking: ${trackingNumber}\n` +
    `Pickup Code: ${pickupCode}\n` +
    (lockerId ? `Location: ${lockerId}\n` : '') +
    `\nYou have 48 hours to collect your parcel.`;

  try {
    // Convert BigInt to string for serialization (Telegram API accepts string or number)
    const chatIdStr = typeof chatId === 'bigint' ? chatId.toString() : String(chatId);
    const response = await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
      chat_id: chatIdStr,
      text: message,
      parse_mode: 'HTML',
    });

    if (response.data.ok) {
      console.log(`[Telegram] ✅ Sent pickup code to chat ${chatId} for ${trackingNumber}`);
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
 * Send send/drop-off code to user via Telegram
 */
export async function sendSendCodeToTelegram(
  chatId: bigint | number,
  trackingNumber: string,
  sendCode: string,
  recipientName?: string | null
): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('[Telegram] Bot token not configured');
    return false;
  }

  const message = `📮 Your InPost drop-off code is ready!\n\n` +
    (recipientName ? `To: ${recipientName}\n` : '') +
    `Tracking: ${trackingNumber}\n` +
    `Drop-off Code: ${sendCode}\n` +
    `\nUse this code to drop off your parcel at any InPost locker or shop.`;

  try {
    // Convert BigInt to string for serialization (Telegram API accepts string or number)
    const chatIdStr = typeof chatId === 'bigint' ? chatId.toString() : String(chatId);
    const response = await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
      chat_id: chatIdStr,
      text: message,
      parse_mode: 'HTML',
    });

    if (response.data.ok) {
      console.log(`[Telegram] ✅ Sent send code to chat ${chatId} for ${trackingNumber}`);
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
 * Get Telegram username from Telegram user ID via getChatMember.
 * For a private chat with a user, chat_id equals the user's id, so we use that.
 * Returns @username or null if not available or user hasn't started the bot.
 */
export async function getTelegramUsernameByUserId(
  telegramUserId: string | number | bigint
): Promise<string | null> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error('[Telegram] Bot token not configured');
    return null;
  }

  const uid = typeof telegramUserId === 'bigint' ? telegramUserId.toString() : String(telegramUserId);
  try {
    const response = await axios.post(`${TELEGRAM_API_URL}/getChatMember`, {
      chat_id: uid,
      user_id: Number(uid) || uid,
    });
    if (response.data?.ok && response.data?.result?.user?.username) {
      const username = response.data.result.user.username;
      return username.startsWith('@') ? username : `@${username}`;
    }
    return null;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('[Telegram] getChatMember error:', error.response?.data || error.message);
    } else {
      console.error('[Telegram] getChatMember error:', error);
    }
    return null;
  }
}

/**
 * Send error notification to admin (optional)
 */
export async function sendAdminNotification(message: string): Promise<void> {
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!adminChatId || !TELEGRAM_BOT_TOKEN) {
    return;
  }

  try {
    await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
      chat_id: adminChatId,
      text: `⚠️ ${message}`,
    });
  } catch (error) {
    console.error('[Telegram] Failed to send admin notification:', error);
  }
}
