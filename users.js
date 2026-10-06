import { pool } from '../db.js';

/**
 * Resolves a Telegram user to our internal user_id, creating the row if
 * this is the first time we've seen this telegram_id. Used both by
 * Mini App requests (after initData validation) and by ad-network webhooks
 * (which only know the Telegram user ID, not our internal one).
 */
export async function getOrCreateUserByTelegramId(telegramId, username = null) {
  const existing = await pool.query(
    `SELECT id FROM users WHERE telegram_id = $1`,
    [telegramId]
  );
  if (existing.rows.length) return existing.rows[0].id;

  const inserted = await pool.query(
    `INSERT INTO users (telegram_id, username) VALUES ($1, $2) RETURNING id`,
    [telegramId, username]
  );
  return inserted.rows[0].id;
}
