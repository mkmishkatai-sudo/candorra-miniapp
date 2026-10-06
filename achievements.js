import { pool } from '../db.js';

/**
 * Badge definitions. Each `test` runs a real query against the user's actual
 * ledger/withdrawal history - nothing here is awarded on a claim, only on
 * verified fact. Cosmetic only: no coin, no reward-rate change. That's what
 * keeps this list free to extend without touching the reward-pool math.
 */
const BADGES = [
  {
    key: 'first_release',
    label: 'First reward released',
    test: async (userId) => {
      const { rows } = await pool.query(
        `SELECT 1 FROM ledger_entries WHERE user_id = $1 AND type = 'reward_credit' LIMIT 1`, [userId]);
      return rows.length > 0;
    },
  },
  {
    key: 'week_streak',
    label: '7-day check-in streak',
    // NOTE: streak currently lives in the Mini App's local storage (client-side), not the
    // database, so this check cannot run server-side yet. Wire it once check-in state moves
    // server-side; leaving the test explicit (returns false) rather than silently skipping it.
    test: async () => false,
  },
  {
    key: 'first_withdrawal',
    label: 'First withdrawal sent',
    test: async (userId) => {
      const { rows } = await pool.query(
        `SELECT 1 FROM withdrawals WHERE user_id = $1 AND status = 'sent' LIMIT 1`, [userId]);
      return rows.length > 0;
    },
  },
  {
    key: 'community_member',
    label: 'Joined @CandorraOfficial',
    test: async (userId) => {
      const { rows } = await pool.query(
        `SELECT 1 FROM one_time_bonuses WHERE user_id = $1 AND bonus_type = 'channel_subscribe' LIMIT 1`, [userId]);
      return rows.length > 0;
    },
  },
];

/** Call after any ledger-affecting action. Cheap: each test is a small indexed query. */
export async function checkAndAwardAchievements(userId) {
  const newly = [];
  for (const badge of BADGES) {
    const already = await pool.query(
      `SELECT 1 FROM achievements WHERE user_id = $1 AND badge = $2`, [userId, badge.key]);
    if (already.rows.length) continue;
    if (await badge.test(userId)) {
      await pool.query(
        `INSERT INTO achievements (user_id, badge) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, badge.key]
      );
      newly.push(badge.key);
    }
  }
  return newly;
}

export async function listAchievements(userId) {
  const { rows } = await pool.query(
    `SELECT badge, earned_at FROM achievements WHERE user_id = $1 ORDER BY earned_at`, [userId]);
  return rows;
}
