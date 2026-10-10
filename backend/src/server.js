import express from 'express';
import 'dotenv/config';
import { validateInitData } from './lib/telegramAuth.js';
import { getBalance, releaseDueRewards } from './services/ledger.js';
import { requestWithdrawal } from './services/withdrawals.js';
import { getOrCreateUserByTelegramId } from './services/users.js';
import { claimChannelSubscribeBonus } from './services/bonuses.js';
import { listAchievements } from './services/achievements.js';
import { getSummary } from './services/summary.js';
import { webhookRouter } from './routes/webhooks.js';
import { telegramRouter } from './routes/telegram.js';
import { monetagRouter } from './routes/monetag.js';
import { pool } from './db.js';

const app = express();
app.use(express.json());

/**
 * Every Mini App request must carry a valid Telegram initData string.
 * Nothing past this point trusts client-supplied identity without this check.
 */
function requireTelegramAuth(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];
  const result = validateInitData(initData, process.env.BOT_TOKEN);
  if (!result.ok) {
    return res.status(401).json({ error: result.reason });
  }
  req.telegramUser = result.user;
  next();
}

async function resolveUser(req) {
  return getOrCreateUserByTelegramId(String(req.telegramUser.id), req.telegramUser.username ?? null);
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/api/summary', requireTelegramAuth, async (req, res) => {
  try {
    const userId = await resolveUser(req);
    res.json(await getSummary(userId));
  } catch (err) {
    console.error('[api/summary]', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

app.get('/api/balance', requireTelegramAuth, async (req, res) => {
  try {
    const userId = await resolveUser(req);
    const balance = await getBalance(userId);
    res.json({ ok: true, balanceUsd: Number(balance) });
  } catch (err) {
    console.error('[api/balance]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Rewards currently waiting in the Vault (verification window not finished yet).
app.get('/api/vault', requireTelegramAuth, async (req, res) => {
  try {
    const userId = await resolveUser(req);
    const { rows } = await pool.query(
      `SELECT amount, created_at, release_at FROM pending_rewards
       WHERE user_id = $1 AND status = 'pending'
       ORDER BY release_at LIMIT 50`,
      [userId]
    );
    res.json({
      holdHours: Number(process.env.HOLD_HOURS ?? 24),
      items: rows.map(r => ({
        amountUsd: Number(r.amount),
        createdAt: r.created_at,
        releaseAt: r.release_at,
      })),
    });
  } catch (err) {
    console.error('[api/vault]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/withdrawals', requireTelegramAuth, async (req, res) => {
  try {
    const userId = await resolveUser(req);
    const { amount, tonWalletAddress } = req.body ?? {};
    const result = await requestWithdrawal({ userId, amount, tonWalletAddress });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[api/withdrawals]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/api/tasks/channel-subscribe/claim', requireTelegramAuth, async (req, res) => {
  try {
    const userId = await resolveUser(req);
    const result = await claimChannelSubscribeBonus({ userId, telegramUserId: req.telegramUser.id });
    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    console.error('[api/tasks/channel-subscribe]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.get('/api/achievements', requireTelegramAuth, async (req, res) => {
  try {
    const userId = await resolveUser(req);
    res.json({ items: await listAchievements(userId) });
  } catch (err) {
    console.error('[api/achievements]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.use('/webhooks', webhookRouter);
app.use('/webhooks/telegram', telegramRouter);
app.use('/webhooks/monetag', monetagRouter);

// Vault release loop. On a free host that sleeps, this simply catches up after wake-up:
// releaseDueRewards() releases everything whose release_at is already in the past.
async function releaseTick() {
  try {
    const r = await releaseDueRewards();
    if (r.released || r.voided) console.log(`[vault] released ${r.released}, voided ${r.voided}`);
  } catch (err) {
    console.error('[vault] release failed:', err);
  }
}
if (process.env.DATABASE_URL) {
  setInterval(releaseTick, 60_000);
  releaseTick();
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Candorra backend listening on port ${PORT}`));
