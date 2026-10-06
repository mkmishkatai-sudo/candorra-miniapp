import { Router } from 'express';

export const telegramRouter = Router();

/**
 * Handles Telegram Bot API updates directly - replaces TeleBotHost entirely.
 * Set this as your webhook once deployed:
 *   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://YOUR-RENDER-URL/webhooks/telegram
 *
 * This is real, syntax-checked Node.js - unlike the TBL script, this can
 * actually be verified before you paste it anywhere.
 */

async function sendMessage(chatId, text, extra = {}) {
  const url = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, ...extra }),
  });
  const data = await res.json();
  if (!data.ok) console.error('[sendMessage] Telegram API error:', data.description);
  return data;
}

async function answerCallbackQuery(callbackQueryId) {
  const url = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/answerCallbackQuery`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  });
}

const MINIAPP_URL = process.env.MINIAPP_URL; // e.g. https://candorra-miniapp.onrender.com/
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID; // your numeric ID, e.g. 6534482918

telegramRouter.post('/', async (req, res) => {
  // Always 200 quickly - Telegram retries aggressively on non-200/timeout.
  res.sendStatus(200);

  const update = req.body;

  try {
    if (update.message) {
      const chatId = update.message.chat.id;
      const text = update.message.text ?? '';

      if (text === '/start') {
        await sendMessage(chatId,
          "Welcome to Candorra.\n\n" +
          "We're the earning platform that shows its math \u2014 every reward you see " +
          "has a real source, shown plainly, before you ever tap anything.\n\n" +
          "No purchase is ever required to earn. No fee is ever required to withdraw.",
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Open Candorra', web_app: { url: MINIAPP_URL } }],
                [{ text: 'How rewards work (Trust Center)', callback_data: 'trust_center' }],
              ],
            },
          }
        );
      } else if (text === '/help') {
        await sendMessage(chatId,
          "Candorra \u2014 quick help\n\n" +
          "\u2022 /start \u2014 open the app\n" +
          "\u2022 Withdrawals are reviewed before sending, never instant, never require a fee\n" +
          "\u2022 Official channel: @CandorraOfficial\n" +
          "\u2022 Having an issue? Reply here and describe what happened."
        );
      } else if (text === '/broadcast') {
        if (String(update.message.from.id) === String(ADMIN_TELEGRAM_ID)) {
          await sendMessage(chatId, 'Broadcast command received \u2014 not yet wired to a subscriber list.');
        } else {
          await sendMessage(chatId, 'This command is restricted.');
        }
      }
    }

    if (update.callback_query) {
      const cq = update.callback_query;
      await answerCallbackQuery(cq.id);
      if (cq.data === 'trust_center') {
        await sendMessage(cq.message.chat.id,
          "How Candorra works:\n\n" +
          "1. Advertisers pay for real actions (a video watched, an offer completed)\n" +
          "2. A transparent share of that real payment goes to you\n" +
          "3. Withdrawals are reviewed, never instant, never fee-gated\n\n" +
          "Full detail is inside the app under Trust."
        );
      }
    }
  } catch (err) {
    console.error('[telegram webhook] error:', err);
  }
});
