import { checkAndAwardAchievements } from './achievements.js';
/**
 * Real server-side daily cap - this did not exist before (only a 20s cooldown did).
 * Flat cap for now (80/day, the highest tier's display value) since per-tier streak
 * state currently lives client-side only (see achievements.js comment) and the
 * server has no way to know a user's real tier yet. Once streak moves server-side,
 * this can become tier-aware. Counts verified ad_network_events across BOTH
 * networks (adsgram + monetag combined), so the cap is a real total, not per-network.
 */
export async function countTodayAdEvents(pool, userId) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM ad_network_events
     WHERE user_id = $1 AND verified_at >= date_trunc('day', now())`,
    [userId]
  );
  return rows[0].n;
}

import { pool } from '../db.js';

/**
 * Returns a user's current balance, derived from the ledger (never stored directly).
 */
export async function getBalance(userId) {
  const { rows } = await pool.query(
    `SELECT balance_after FROM ledger_entries
     WHERE user_id = $1
     ORDER BY id DESC
     LIMIT 1`,
    [userId]
  );
  return rows[0]?.balance_after ?? 0;
}

/**
 * Records a reward credit from a verified ad-network event.
 * Idempotent: relies on the UNIQUE (network_name, external_event_id) constraint
 * in ad_network_events — if this event was already processed, the insert into
 * ad_network_events fails and no ledger entry is created, even under retry.
 *
 * This function runs inside a single DB transaction so the event record and
 * the ledger entry are written atomically — never one without the other.
 */
export async function creditRewardFromAdEvent({
  userId,
  networkName,
  externalEventId,
  grossPayout,
  userRewardAmount,
  rawPayload,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let eventId;
    try {
      const eventResult = await client.query(
        `INSERT INTO ad_network_events
           (network_name, external_event_id, user_id, gross_payout, raw_payload)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [networkName, externalEventId, userId, grossPayout, rawPayload]
      );
      eventId = eventResult.rows[0].id;
    } catch (err) {
      if (err.code === '23505') {
        // Unique violation = we've already processed this exact event. Not an error —
        // this IS the idempotency protection working as intended.
        await client.query('ROLLBACK');
        return { ok: true, alreadyProcessed: true };
      }
      throw err;
    }

    const currentBalance = await getBalance(userId);
    const newBalance = Number(currentBalance) + Number(userRewardAmount);

    await client.query(
      `INSERT INTO ledger_entries
         (user_id, amount, type, source_table, source_id, balance_after, metadata)
       VALUES ($1, $2, 'reward_credit', 'ad_network_events', $3, $4, $5)`,
      [userId, userRewardAmount, eventId, newBalance, { networkName, grossPayout }]
    );

    await client.query('COMMIT');
    return { ok: true, alreadyProcessed: false, newBalance };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}


/**
 * Vault step 1: record a verified ad event and PARK the reward in pending_rewards.
 * Same idempotency guarantee as creditRewardFromAdEvent (UNIQUE on ad_network_events).
 * Nothing touches the ledger yet, so the available balance does not change.
 */
export async function holdRewardFromAdEvent({
  userId, networkName, externalEventId, grossPayout, userRewardAmount, rawPayload, holdHours,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let eventId;
    try {
      const ev = await client.query(
        `INSERT INTO ad_network_events
           (network_name, external_event_id, user_id, gross_payout, raw_payload)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [networkName, externalEventId, userId, grossPayout, rawPayload]
      );
      eventId = ev.rows[0].id;
    } catch (err) {
      if (err.code === '23505') { await client.query('ROLLBACK'); return { ok: true, alreadyProcessed: true }; }
      throw err;
    }

    const pending = await client.query(
      `INSERT INTO pending_rewards (user_id, amount, ad_event_id, release_at)
       VALUES ($1, $2, $3, now() + make_interval(hours => $4::int))
       RETURNING id, release_at`,
      [userId, userRewardAmount, eventId, holdHours]
    );

    await client.query('COMMIT');
    return { ok: true, alreadyProcessed: false, pending: pending.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Vault step 2: release every reward whose hold has ended into the append-only ledger.
 * Safe to call repeatedly and from several instances (FOR UPDATE SKIP LOCKED).
 * Rewards of banned users are voided instead of released (they stay in the audit trail).
 * Catch-up behaviour: if the server slept, the next call releases everything that came due.
 */
export async function releaseDueRewards(limit = 200) {
  const client = await pool.connect();
  let released = 0;
  let voided = 0;
  try {
    await client.query('BEGIN');
const awardAfter = [];
    const due = await client.query(
      `SELECT id, user_id, amount, ad_event_id FROM pending_rewards
       WHERE status = 'pending' AND release_at <= now()
       ORDER BY release_at LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit]
    );

    for (const row of due.rows) {
      // Lock the user row so balance_after is computed against a stable latest entry.
      const u = await client.query(`SELECT status FROM users WHERE id = $1 FOR UPDATE`, [row.user_id]);
      if (u.rows[0]?.status === 'banned') {
        await client.query(`UPDATE pending_rewards SET status = 'voided', resolved_at = now() WHERE id = $1`, [row.id]);
        voided++;
        continue;
      }
      const bal = await client.query(
        `SELECT balance_after FROM ledger_entries WHERE user_id = $1 ORDER BY id DESC LIMIT 1`,
        [row.user_id]
      );
      const newBalance = Number(bal.rows[0]?.balance_after ?? 0) + Number(row.amount);
      await client.query(
        `INSERT INTO ledger_entries (user_id, amount, type, source_table, source_id, balance_after, metadata)
         VALUES ($1, $2, 'reward_credit', 'pending_rewards', $3, $4, $5)`,
        [row.user_id, row.amount, row.id, newBalance, { adEventId: row.ad_event_id }]
      );
      await client.query(`UPDATE pending_rewards SET status = 'released', resolved_at = now() WHERE id = $1`, [row.id]);
      released++;
      awardAfter.push(row.user_id);
    }

    await client.query('COMMIT');
    for (const uid of awardAfter) { try { await checkAndAwardAchievements(uid); } catch (e) { console.error('[achievements]', e); } }
    return { released, voided };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
