const ADMIN_RIGHTS = "delete_messages+manage_topics+restrict_members";

export function getAddToGroupUrl(botUsername) {
  return `https://t.me/${botUsername}?startgroup=true&admin=${ADMIN_RIGHTS}`;
}

export function getAddToChannelUrl(botUsername) {
  return `https://t.me/${botUsername}?startchannel&admin=post_messages+delete_messages+manage_topics`;
}

export function getBotDmUrl(botUsername, startParam = "ready") {
  return `https://t.me/${botUsername}?start=${startParam}`;
}

export function getGroupOpenUrl(username) {
  if (!username) return null;
  return `https://t.me/${username}`;
}

let cachedUsername = null;

export async function getBotUsername(telegram) {
  if (!cachedUsername) {
    cachedUsername = (await telegram.getMe()).username;
  }
  return cachedUsername;
}
