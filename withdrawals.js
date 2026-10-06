import { pool } from '../db.js';
import { getBalance } from './ledger.js';

const VALID_TRANSITIONS = {
  requested: ['under_review', 'rejected'],
  under_review: ['approved', 'rejected'],
  approved: ['sent', 'failed'],
  sent: [],
  failed: ['under_review'], // allow retry after investigating a failure
  rejected: [],
};

export async function requestWithdrawal({ userId, amount, tonWalletAddress }) {
  // Emergency/launch gate: withdrawals stay closed until the owner explicitly opens them
  // (WITHDRAWALS_OPEN=true). This is also the kill-switch: set it back to anything else to pause.
  if (process.env.WITHDRAWALS_OPEN !== 'true') {
    return { ok: false, reason: 'withdrawals_not_open' };
  }
  const minUsd = Number(process.env.MIN_WITHDRAWAL_USD ?? 5);
  if (Number(amount) < minUsd) {
    return { ok: false, reason: 'below_minimum', minimum: minUsd };
  }
  const balance = await getBalance(userId);
  if (Number(amount) > Number(balance)) {
    return { ok: false, reason: 'insufficient_balance' };
  }

  const { rows } = await pool.query(
    `INSERT INTO withdrawals (user_id, amount, ton_wallet_address, status)
     VALUES ($1, $2, $3, 'requested')
     RETURNING id, status, requested_at`,
    [userId, amount, tonWalletAddress]
  );

  return { ok: true, withdrawal: rows[0] };
}

/**
 * Admin-only. Moves a withdrawal through its state machine.
 * Every call MUST be paired with an admin_actions audit row by the caller
 * (see routes/admin.js) — this function does not write the audit log itself
 * so that the caller can capture the authenticated admin's identity.
 */
export async function transitionWithdrawal({ withdrawalId, newStatus }) {
  const { rows } = await pool.query(
    `SELECT status FROM withdrawals WHERE id = $1`,
    [withdrawalId]
  );
  if (!rows.length) return { ok: false, reason: 'not_found' };

  const currentStatus = rows[0].status;
  if (!VALID_TRANSITIONS[currentStatus]?.includes(newStatus)) {
    return { ok: false, reason: `invalid_transition_${currentStatus}_to_${newStatus}` };
  }

  const resolvedStatuses = ['sent', 'failed', 'rejected'];
  await pool.query(
    `UPDATE withdrawals
     SET status = $1, resolved_at = ${resolvedStatuses.includes(newStatus) ? 'now()' : 'resolved_at'}
     WHERE id = $2`,
    [newStatus, withdrawalId]
  );

  // The actual debit is only recorded once truly "sent" — never on "approved" alone,
  // so a withdrawal that later fails never left a phantom debit on the ledger.
  if (newStatus === 'sent') {
    const wd = await pool.query(`SELECT user_id, amount FROM withdrawals WHERE id = $1`, [withdrawalId]);
    const { user_id, amount } = wd.rows[0];
    const currentBalance = await getBalance(user_id);
    const newBalance = Number(currentBalance) - Number(amount);
    await pool.query(
      `INSERT INTO ledger_entries (user_id, amount, type, source_table, source_id, balance_after)
       VALUES ($1, $2, 'withdrawal_debit', 'withdrawals', $3, $4)`,
      [user_id, -Math.abs(amount), withdrawalId, newBalance]
    );
  }

  return { ok: true };
}
