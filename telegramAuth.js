import crypto from 'node:crypto';

/**
 * Validates Telegram Mini App initData server-side.
 * This implements Telegram's documented validation algorithm:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * NEVER trust `initDataUnsafe` from the client directly — always run the raw
 * initData string through this function first.
 *
 * @param {string} initData - the raw initData string sent by the Telegram client
 * @param {string} botToken - your bot token (from process.env.BOT_TOKEN)
 * @param {number} maxAgeSeconds - reject sessions older than this (replay protection)
 * @returns {{ ok: boolean, user?: object, reason?: string }}
 */
export function validateInitData(initData, botToken, maxAgeSeconds = 3600) {
  if (!initData || !botToken) {
    return { ok: false, reason: 'missing_initdata_or_token' };
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'missing_hash' };
  params.delete('hash');

  // Build the data-check-string: sorted key=value pairs joined by \n
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  // Timing-safe comparison
  const validSignature =
    computedHash.length === hash.length &&
    crypto.timingSafeEqual(Buffer.from(computedHash), Buffer.from(hash));

  if (!validSignature) {
    return { ok: false, reason: 'invalid_signature' };
  }

  const authDate = Number(params.get('auth_date'));
  const ageSeconds = Date.now() / 1000 - authDate;
  if (!authDate || ageSeconds > maxAgeSeconds) {
    return { ok: false, reason: 'expired_session' };
  }

  let user;
  try {
    user = JSON.parse(params.get('user') || '{}');
  } catch {
    return { ok: false, reason: 'malformed_user_field' };
  }

  return { ok: true, user };
}
