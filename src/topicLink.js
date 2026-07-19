/**
 * Parse Telegram topic links such as:
 * - https://t.me/pledgefinance/4   (specific topic)
 * - https://t.me/pledgefinance     (All tab / main feed)
 * - t.me/c/1234567890/4
 * - t.me/c/1234567890              (private All tab)
 */
export const ALL_THREAD_ID = 0;

export function parseTopicLink(input) {
  const cleaned = input.trim().replace(/^https?:\/\//, "");

  const privateMatch = cleaned.match(/(?:t\.me|telegram\.me)\/c\/(\d+)\/(\d+)/i);
  if (privateMatch) {
    return {
      chatId: Number(`-100${privateMatch[1]}`),
      threadId: Number(privateMatch[2]),
    };
  }

  const publicMatch = cleaned.match(/(?:t\.me|telegram\.me)\/([a-zA-Z0-9_]+)\/(\d+)/i);
  if (publicMatch && publicMatch[1].toLowerCase() !== "c") {
    return {
      username: publicMatch[1],
      threadId: Number(publicMatch[2]),
    };
  }

  const privateChannelMatch = cleaned.match(/(?:t\.me|telegram\.me)\/c\/(\d+)\/?$/i);
  if (privateChannelMatch) {
    return {
      chatId: Number(`-100${privateChannelMatch[1]}`),
      threadId: ALL_THREAD_ID,
    };
  }

  const publicChannelMatch = cleaned.match(/(?:t\.me|telegram\.me)\/([a-zA-Z0-9_]+)\/?$/i);
  if (publicChannelMatch && publicChannelMatch[1].toLowerCase() !== "c") {
    return {
      username: publicChannelMatch[1],
      threadId: ALL_THREAD_ID,
    };
  }

  return null;
}

export async function resolveTopicLink(telegram, parsed) {
  let chatId = parsed.chatId;
  let username = parsed.username;

  if (!chatId && username) {
    const chat = await telegram.getChat(`@${username}`);
    chatId = chat.id;
    username = chat.username || username;
  }

  return {
    chatId,
    threadId: parsed.threadId,
    username,
    link: username
      ? parsed.threadId === ALL_THREAD_ID
        ? `https://t.me/${username}`
        : `https://t.me/${username}/${parsed.threadId}`
      : null,
  };
}

export function formatTopicLink(username, threadId) {
  if (!username) return null;
  return threadId === ALL_THREAD_ID
    ? `https://t.me/${username}`
    : `https://t.me/${username}/${threadId}`;
}

export function extractTopicUrls(text) {
  const matches =
    text.match(
      /(?:https?:\/\/)?(?:t\.me|telegram\.me)\/(?:c\/\d+(?:\/\d+)?|[a-zA-Z0-9_]+(?:\/\d+)?)/gi
    ) || [];
  return [...new Set(matches.map((url) => url.trim().replace(/[.,;]+$/, "")))];
}

export function parseRestrictLinkArgs(text) {
  const trimmed = text.trim();
  const urlMatch = trimmed.match(/^(https?:\/\/\S+|t\.me\/\S+)/i);
  if (!urlMatch) return null;

  const url = urlMatch[1];
  const purpose = trimmed.slice(url.length).trim();
  return { url, purpose };
}

export function parseWatchedTopics(raw, defaultPurpose) {
  if (!raw?.trim()) return [];

  return raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf("|");
      if (separator === -1) {
        return { url: entry, purpose: defaultPurpose };
      }
      return {
        url: entry.slice(0, separator).trim(),
        purpose: entry.slice(separator + 1).trim() || defaultPurpose,
      };
    });
}
