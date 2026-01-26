import express, { Request, Response } from 'express';
import axios from 'axios';

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
        `/help - Show this help`;

      await sendTelegramMessage(chatId, responseText);
      return res.status(200).json({ ok: true });
    }

    // Default response for any other message
    const responseText = `👋 Hello! I'm the InPost Tracking Bot.\n\n` +
      `Send /start to get your Chat ID and setup instructions.\n\n` +
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

export default router;
