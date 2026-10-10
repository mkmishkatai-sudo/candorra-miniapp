import { pool } from '../db.js';
import { getBalance, countTodayAdEvents } from './ledger.js';

/**
 * Streak = consecutive UTC days (ending today, or yesterday if you haven't
 * watched yet today) on which at least one VERIFIED ad event exists. It is
 * derived from real ad_network_events, so it cannot be faked by a button tap
 * and needs no extra table.
 */
export function computeStreak(dateStrings, todayStr) {
  const set = new Set(dateStrings);
  const dayMs = 86400000;
  const shift = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * dayMs).toISOString().slice(0, 10);
  let cursor = set.has(todayStr) ? todayStr : shift(todayStr, -1);
  let streak = 0;
  while (set.has(cursor)) { streak++; cursor = shift(cursor, -1); }
  return streak;
}

/**
 * Share of ELIGIBLE revenue paid to the user, by streak. Pool-neutral design:
 * it never exceeds REWARD_POOL_PCT (default 45%), so a long streak moves the
 * split, it does not create new liability.
 */
export function shareForStreak(streak) {
  const top = Number(process.env.REWARD_POOL_PCT ?? 0.45);
  if (streak >= 7) return top;
  if (streak >= 3) return Math.min(top, 0.43);
  return Math.min(top, 0.40);
}

export async function getStreak(userId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT to_char(verified_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d
     FROM ad_network_events
     WHERE user_id = $1 AND verified_at > now() - interval '60 days'`,
    [userId]
  );
  const today = new Date().toISOString().slice(0, 10);
  return computeStreak(rows.map(r => r.d), today);
}

export async function getSummary(userId) {
  const [balance, todayCount, streakDays, subsidyLeftUsd] = await Promise.all([
    getBalance(userId), countTodayAdEvents(pool, userId), getStreak(userId), getSubsidyLeftToday(),
  ]);
  return {
    ok: true,
    balanceUsd: Number(balance),
    todayCount,
    streakDays,
    sharePct: shareForStreak(streakDays),
    goal: Number(process.env.DAILY_GOAL ?? 5),
    targetCoin: Number(process.env.TARGET_REWARD_COIN ?? 0),
    subsidyActive: subsidyLeftUsd > 0,
  };
}


/**
 * Owner-funded top-up so a reward can reach TARGET_REWARD_COIN even when the
 * ad's real revenue share is lower. Bounded by a daily budget (a hard cap on
 * the owner's exposure). Pure function so it can be tested without a database.
 */
export function applySubsidy(formulaUsd, targetUsd, budgetLeftUsd) {
  if (!(targetUsd > formulaUsd) || !(budgetLeftUsd > 0)) return { rewardUsd: formulaUsd, subsidyUsd: 0 };
  const subsidyUsd = Math.min(targetUsd - formulaUsd, budgetLeftUsd);
  return { rewardUsd: formulaUsd + subsidyUsd, subsidyUsd };
}

export function targetRewardUsd() {
  const coin = Number(process.env.TARGET_REWARD_COIN ?? 0);
  const perUsd = Number(process.env.COIN_PER_USD ?? 1000);
  return coin > 0 ? coin / perUsd : 0;
}

export async function getSubsidyLeftToday() {
  const budget = Number(process.env.SUBSIDY_BUDGET_USD_PER_DAY ?? 0);
  if (!(budget > 0)) return 0;
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM((raw_payload->>'subsidyUsd')::numeric), 0) AS spent
     FROM ad_network_events WHERE verified_at >= date_trunc('day', now())`
  );
  return Math.max(0, budget - Number(rows[0].spent));
}
