import { topicDiscovery } from "./topicDiscovery.js";
import { storage } from "./storage.js";

const SCAN_LIMIT = 50;
const PROBE_DELAY_MS = 80;

function isPlaceholderName(name) {
  return /^Topic #\d+$/.test(name);
}

function sortTopics(topics) {
  topics.sort((a, b) => {
    if (a.threadId === 1) return -1;
    if (b.threadId === 1) return 1;
    return a.name.localeCompare(b.name);
  });
  return topics;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function probeTopicExists(telegram, chatId, threadId) {
  try {
    const msg = await telegram.sendMessage(chatId, "\u200b", {
      message_thread_id: threadId,
      disable_notification: true,
    });
    await telegram.deleteMessage(chatId, msg.message_id);
    return true;
  } catch {
    return false;
  }
}

function resolveName(chatId, threadId) {
  const cached = topicDiscovery.listByChat(chatId).find((t) => t.threadId === threadId);
  if (cached?.name && !isPlaceholderName(cached.name)) return cached.name;
  if (threadId === 1) return "General";
  return `Topic #${threadId}`;
}

function collectKnownTopics(chatId) {
  const map = new Map();

  for (const t of topicDiscovery.listByChat(chatId)) {
    if (isPlaceholderName(t.name)) continue;
    map.set(t.threadId, t.name);
  }

  for (const [threadId, name] of storage.listTopics(chatId)) {
    if (!map.has(threadId)) map.set(threadId, name);
  }

  return map;
}

async function scanTopics(telegram, chatId) {
  const found = collectKnownTopics(chatId);

  for (let threadId = 2; threadId <= SCAN_LIMIT; threadId++) {
    if (found.has(threadId)) continue;

    const exists = await probeTopicExists(telegram, chatId, threadId);
    if (exists) found.set(threadId, resolveName(chatId, threadId));

    await sleep(PROBE_DELAY_MS);
  }

  return [...found.entries()].map(([threadId, name]) => ({ threadId, name }));
}

export async function fetchTopicsForChat(telegram, chatId, chatTitle) {
  let chat;
  try {
    chat = await telegram.getChat(chatId);
  } catch {
    return sortTopics(
      topicDiscovery
        .listByChat(chatId)
        .filter((t) => !isPlaceholderName(t.name))
        .map(({ threadId, name }) => ({ threadId, name }))
    );
  }

  const title = chat.title || chat.username || chatTitle || String(chatId);
  const topics = await scanTopics(telegram, chatId);
  topicDiscovery.replaceTopicsForChat(chatId, topics, title);
  return sortTopics(topics);
}
