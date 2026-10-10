/**
 * Thin wrapper around the Telegram Bot API for server-to-server calls
 * (as opposed to telegramAuth.js, which validates client-sent initData).
 */
export async function getChatMemberStatus(chatIdOrUsername, telegramUserId, botToken) {
  const url = `https://api.telegram.org/bot${botToken}/getChatMember` +
    `?chat_id=${encodeURIComponent(chatIdOrUsername)}&user_id=${encodeURIComponent(telegramUserId)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.ok) {
    // Common cause: bot is not an admin in the chat, or the user has never interacted with it.
    // Telegram's own error description is returned so this is debuggable without guessing.
    throw new Error(`getChatMember failed: ${data.description ?? 'unknown error'}`);
  }
  return data.result.status; // 'creator' | 'administrator' | 'member' | 'restricted' | 'left' | 'kicked'
}

export function isSubscribed(status) {
  return status === 'creator' || status === 'administrator' || status === 'member';
}
