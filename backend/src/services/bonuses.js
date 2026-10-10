import { checkAndAwardAchievements } from './achievements.js';
import { pool } from '../db.js';
import { getBalance } from './ledger.js';
import { getChatMemberStatus, isSubscribed } from '../lib/telegram.js';

/**
 * Verifies real channel membership via Telegram's own API (not client-reported),
 * then credits a one-time, owner-funded bonus. UNIQUE (user_id, bonus_type) in the
 * schema makes double-claiming impossible even under a race/retry.
 *
 * This does NOT go through the Vault (pending_rewards): the Vault hold exists to
 * cover an ad network's invalid-traffic reconciliation window, which doesn't apply
 * here - there is no ad network involved, so there's nothing to reconcile.
 */
export async function claimChannelSubscribeBonus({ userId, telegramUserId }) {
  const channel = process.env.OFFICIAL_CHANNEL_USERNAME; // e.g. '@CandorraOfficial'
  const status = await getChatMemberStatus(channel, telegramUserId, process.env.BOT_TOKEN);
  if (!isSubscribed(status)) {
    return { ok: false, reason: 'not_subscribed', status };
  }

  const amount = Number(process.env.CHANNEL_SUBSCRIBE_BONUS_USD ?? 0.003); // owner decision: 3 coin
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let bonusId;
    try {
      const inserted = await client.query(
        `INSERT INTO one_time_bonuses (user_id, bonus_type, amount)
         VALUES ($1, 'channel_subscribe', $2) RETURNING id`,
        [userId, amount]
      );
      bonusId = inserted.rows[0].id;
    } catch (err) {
      if (err.code === '23505') { // already claimed - not an error, just a no-op
        await client.query('ROLLBACK');
        return { ok: true, alreadyClaimed: true };
      }
      throw err;
    }

    const currentBalance = await getBalance(userId);
    const newBalance = Number(currentBalance) + amount;
    await client.query(
      `INSERT INTO ledger_entries (user_id, amount, type, source_table, source_id, balance_after, metadata)
       VALUES ($1, $2, 'reward_credit', 'one_time_bonuses', $3, $4, $5)`,
      [userId, amount, bonusId, newBalance, { bonusType: 'channel_subscribe' }]
    );
    await client.query('COMMIT');
    try { await checkAndAwardAchievements(userId); } catch (e) { console.error('[achievements]', e); }
    return { ok: true, alreadyClaimed: false, amountUsd: amount, newBalance };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * The community-growth mechanism that actually matters: a live gate on earning,
 * not a recurring payment. Call this before crediting any Watch & Earn reward
 * once that flow is wired to AdsGram. If the user has left the channel, block
 * the reward and tell them why - don't silently pay anyway, and don't silently
 * drop the reward without explanation either.
 */
export async function requireChannelMembership(telegramUserId) {
  const channel = process.env.OFFICIAL_CHANNEL_USERNAME;
  const status = await getChatMemberStatus(channel, telegramUserId, process.env.BOT_TOKEN);
  return isSubscribed(status);
}
