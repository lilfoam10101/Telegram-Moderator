import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "data", "discovered_topics.json");

class TopicDiscovery {
  constructor() {
    this.data = this.load();
  }

  load() {
    if (!fs.existsSync(DATA_FILE)) return {};
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  }

  save() {
    const dir = path.dirname(DATA_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), "utf-8");
  }

  register(chatId, threadId, name, chatTitle = null) {
    const key = String(chatId);
    if (!this.data[key]) {
      this.data[key] = { chatTitle: chatTitle || key, topics: {} };
    }
    if (chatTitle) this.data[key].chatTitle = chatTitle;
    this.data[key].topics[String(threadId)] = {
      threadId: Number(threadId),
      name,
      updatedAt: new Date().toISOString(),
    };
    this.save();
  }

  listByChat(chatId) {
    const entry = this.data[String(chatId)];
    if (!entry) return [];
    return Object.values(entry.topics || {}).sort((a, b) => a.name.localeCompare(b.name));
  }

  listAll() {
    return Object.entries(this.data).flatMap(([chatId, entry]) =>
      Object.values(entry.topics || {}).map((t) => ({
        chatId: Number(chatId),
        chatTitle: entry.chatTitle,
        ...t,
      }))
    );
  }

  getChatTitle(chatId) {
    return this.data[String(chatId)]?.chatTitle || null;
  }

  replaceTopicsForChat(chatId, topics, chatTitle = null) {
    const key = String(chatId);
    this.data[key] = {
      chatTitle: chatTitle || this.data[key]?.chatTitle || key,
      topics: {},
    };
    for (const { threadId, name } of topics) {
      this.data[key].topics[String(threadId)] = {
        threadId: Number(threadId),
        name,
        updatedAt: new Date().toISOString(),
      };
    }
    this.save();
  }
}

export const topicDiscovery = new TopicDiscovery();

function cachedTopicName(chatId, threadId) {
  const cached = topicDiscovery.listByChat(chatId).find((t) => t.threadId === threadId);
  if (cached?.name && !/^Topic #\d+$/.test(cached.name)) return cached.name;
  if (threadId === 1) return "General";
  return null;
}

export async function discoverTopicFromMessage(telegram, msg, chat) {
  const chatTitle = chat.title || chat.username || String(chat.id);

  if (msg.forum_topic_created) {
    topicDiscovery.register(
      chat.id,
      msg.message_thread_id,
      msg.forum_topic_created.name,
      chatTitle
    );
    return;
  }

  if (msg.forum_topic_edited && msg.message_thread_id) {
    topicDiscovery.register(
      chat.id,
      msg.message_thread_id,
      msg.forum_topic_edited.name || `Topic #${msg.message_thread_id}`,
      chatTitle
    );
    return;
  }

  if (msg.forum_topic_closed && msg.message_thread_id) {
    return;
  }

  if (msg.forum_topic_reopened && msg.message_thread_id) {
    const name =
      cachedTopicName(chat.id, msg.message_thread_id) || `Topic #${msg.message_thread_id}`;
    topicDiscovery.register(chat.id, msg.message_thread_id, name, chatTitle);
    return;
  }

  const threadId = msg.message_thread_id;
  if (!threadId) return;

  const existing = cachedTopicName(chat.id, threadId);
  if (existing) {
    topicDiscovery.register(chat.id, threadId, existing, chatTitle);
  }
}

export function extractForwardedTopic(msg) {
  const chat =
    msg.forward_from_chat ||
    (msg.forward_origin?.type === "channel" && msg.forward_origin.chat) ||
    (msg.forward_origin?.type === "chat" && msg.forward_origin.sender_chat) ||
    null;

  if (!chat) return null;

  const threadId = msg.message_thread_id || null;
  if (!threadId) return null;

  return { chatId: chat.id, threadId, chatTitle: chat.title || chat.username };
}

export function topicButtonLabel(chatTitle, topicName, max = 40) {
  const label = `${chatTitle} / ${topicName}`;
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}
