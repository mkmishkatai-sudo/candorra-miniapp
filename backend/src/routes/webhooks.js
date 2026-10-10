import { Router } from 'express';
import { pool } from '../db.js';
import { getOrCreateUserByTelegramId } from '../services/users.js';
import { holdRewardFromAdEvent, countTodayAdEvents } from '../services/ledger.js';

export const webhookRouter = Router();

/**
 * AdsGram sends: GET /webhooks/adsgram/reward?userid=[telegram_id]&secret=...
 *
 * Two honest limitations of this integration, both flagged to the project
 * owner and neither silently papered over:
 *
 * 1. AdsGram's callback carries no per-event unique ID and no actual payout
 *    amount — just the Telegram user ID. That means:
 *    - We cannot get true idempotency from a network-level unique event ID
 *      the way ad_network_events' schema was designed for. We approximate
 *      it with a same-user/same-block cooldown window instead (below).
 *    - The reward amount is computed from a CONFIGURED ESTIMATE
 *      (ADSGRAM_ESTIMATED_PAYOUT_PER_REWARD), not a real per-event dollar
 *      figure from AdsGram. This must be periodically reconciled against
 *      AdsGram's own dashboard "Earned" total — it is not a substitute for
 *      that reconciliation, only a stand-in until/unless AdsGram exposes
 *      real per-event payout data via their stats API (unverified whether
 *      they do).
 *
 * 2. Whether this callback is fired purely server-to-server by AdsGram, or
 *    triggered client-side in a way that could expose this URL (including
 *    the secret) in a user's own browser network tab, is NOT verified.
 *    If it's the latter, the secret alone is insufficient — the cooldown
 *    check and fraud_signals logging below are the real backstop, not the
 *    secret check.
 */

const COOLDOWN_SECONDS = 20; // minimum gap between rewards for the same user+block

async function countPriorAdEvents(userId) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM ad_network_events WHERE user_id = $1 AND network_name = 'adsgram'`,
    [userId]
  );
  return rows[0].n;
}

function computeUserReward(estimatedGrossPayout, overrideShare) {
  const fraudReservePct = Number(process.env.FRAUD_RESERVE_PCT ?? 0.08);
  const payoutCostPct = Number(process.env.PAYOUT_COST_PCT ?? 0.02);
  const infraReservePct = Number(process.env.INFRA_RESERVE_PCT ?? 0.10);
  const rewardPoolPct = overrideShare ?? Number(process.env.REWARD_POOL_PCT ?? 0.45);

  const eligibleRevenue =
    estimatedGrossPayout * (1 - fraudReservePct - payoutCostPct - infraReservePct);
  const userReward = eligibleRevenue * rewardPoolPct;

  return { eligibleRevenue, userReward };
}

webhookRouter.get('/adsgram/reward', async (req, res) => {
  const { userid, secret, block } = req.query;

  if (!secret || secret !== process.env.ADSGRAM_CALLBACK_SECRET) {
    return res.status(401).json({ error: 'invalid_secret' });
  }
  if (!userid) {
    return res.status(400).json({ error: 'missing_userid' });
  }

  const telegramId = String(userid);
  const blockId = block || process.env.ADSGRAM_REWARD_BLOCK_ID || 'unknown_block';

  try {
    const internalUserId = await getOrCreateUserByTelegramId(telegramId);

    // Cooldown-based duplicate guard (see limitation #1 in the header comment).
    const recent = await pool.query(
      `SELECT verified_at FROM ad_network_events
       WHERE user_id = $1 AND network_name = 'adsgram' AND raw_payload->>'block' = $2
       ORDER BY verified_at DESC LIMIT 1`,
      [internalUserId, blockId]
    );
    if (recent.rows.length) {
      const secondsSinceLast = (Date.now() - new Date(recent.rows[0].verified_at).getTime()) / 1000;
      if (secondsSinceLast < COOLDOWN_SECONDS) {
        // Log as a fraud signal but still return 200 — AdsGram doesn't need
        // to know we rejected it, and retrying won't help them.
        await pool.query(
          `INSERT INTO fraud_signals (user_id, signal_type, weight) VALUES ($1, 'velocity', $2)`,
          [internalUserId, 5.0]
        );
        return res.status(200).json({ ok: true, note: 'deduped_cooldown' });
      }
    }

    // Real daily cap - was never enforced server-side before. See ledger.js comment.
    const todayCount = await countTodayAdEvents(pool, internalUserId);
    const dailyCap = Number(process.env.DAILY_VIEW_CAP ?? 80);
    if (todayCount >= dailyCap) {
      return res.status(200).json({ ok: true, credited: false, reason: 'daily_cap_reached' });
    }

    const estimatedGrossPayout = Number(process.env.ADSGRAM_ESTIMATED_PAYOUT_PER_REWARD ?? 0.001);

    // Welcome Boost: apply only to a brand-new user's first WELCOME_BOOST_VIEWS real ad events.
    const priorViews = await countPriorAdEvents(internalUserId);
    const boostViews = Number(process.env.WELCOME_BOOST_VIEWS ?? 3);
    const isBoosted = priorViews < boostViews;
    const share = isBoosted ? Number(process.env.WELCOME_BOOST_SHARE ?? 0.70) : undefined;
    const { userReward } = computeUserReward(estimatedGrossPayout, share);

    // Synthetic event ID: only dedupes true same-second retries, not
    // deliberate repeat actions — the cooldown check above is the real guard.
    const externalEventId = `${telegramId}-${blockId}-${Math.floor(Date.now() / 1000)}`;

    // The reward goes to the Vault (pending_rewards) first and is released into the ledger
    // after HOLD_HOURS, while the network's invalid-traffic checks can still finish.
    const result = await holdRewardFromAdEvent({
      userId: internalUserId,
      networkName: 'adsgram',
      externalEventId,
      grossPayout: estimatedGrossPayout,
      userRewardAmount: userReward,
      rawPayload: { block: blockId, source: 'adsgram_reward_callback' },
      holdHours: Number(process.env.HOLD_HOURS ?? 24),
    });

    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('[adsgram webhook] error:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
});
