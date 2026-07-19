import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "data", "user_cache.json");

class UserRegistry {
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

  remember(chatId, user) {
    if (!user?.id || user.is_bot) return;
    const chatKey = String(chatId);
    if (!this.data[chatKey]) this.data[chatKey] = {};

    const entry = {
      id: user.id,
      first_name: user.first_name || null,
      username: user.username || null,
      updatedAt: new Date().toISOString(),
    };

    this.data[chatKey][String(user.id)] = entry;
    if (user.username) {
      this.data[chatKey][user.username.toLowerCase()] = entry;
    }
    if (user.first_name) {
      this.data[chatKey][`name:${user.first_name.toLowerCase()}`] = entry;
    }
    this.save();
  }

  _entries(chatId) {
    const chat = this.data[String(chatId)];
    if (!chat) return [];
    const seen = new Set();
    const out = [];
    for (const entry of Object.values(chat)) {
      if (!entry?.id || seen.has(entry.id)) continue;
      seen.add(entry.id);
      out.push(entry);
    }
    return out;
  }

  getByUsername(chatId, username) {
    const chat = this.data[String(chatId)];
    if (!chat) return null;
    const key = username.toLowerCase();
    if (chat[key]) return chat[key];
    for (const entry of this._entries(chatId)) {
      if (entry.username?.toLowerCase() === key) return entry;
    }
    return null;
  }

  getByFirstName(chatId, name) {
    const chat = this.data[String(chatId)];
    if (!chat) return null;
    const key = `name:${name.toLowerCase()}`;
    if (chat[key]) return chat[key];
    const matches = this._entries(chatId).filter(
      (e) => e.first_name?.toLowerCase() === name.toLowerCase()
    );
    return matches.length === 1 ? matches[0] : null;
  }

  getAllUserIds(chatId) {
    return this._entries(chatId).map((e) => e.id);
  }

  search(chatId, query) {
    const q = query.toLowerCase();
    const matches = this._entries(chatId).filter((entry) => {
      const username = entry.username?.toLowerCase() || "";
      const firstName = entry.first_name?.toLowerCase() || "";
      return username.includes(q) || firstName.includes(q) || username === q || firstName === q;
    });
    return matches.length === 1 ? matches[0] : null;
  }

  toUser(entry) {
    if (!entry) return null;
    return {
      id: entry.id,
      first_name: entry.first_name,
      username: entry.username,
    };
  }
}

export const userRegistry = new UserRegistry();

export function rememberMessageUser(chatId, msg) {
  if (msg?.from) userRegistry.remember(chatId, msg.from);
  if (msg?.reply_to_message?.from) {
    userRegistry.remember(chatId, msg.reply_to_message.from);
  }
  for (const entity of msg?.entities || []) {
    if (entity.type === "text_mention" && entity.user) {
      userRegistry.remember(chatId, entity.user);
    }
  }
}

export function rememberChatMember(chatId, member) {
  if (member?.user) userRegistry.remember(chatId, member.user);
}

export async function seedChatUsers(telegram, chatId) {
  try {
    const list = await telegram.getChatAdministrators(chatId);
    for (const entry of list) {
      userRegistry.remember(chatId, entry.user);
    }
  } catch (err) {
    console.warn(`Could not seed users for chat ${chatId}:`, err.message);
  }
}

export async function seedAllKnownChats(telegram) {
  const { chatRegistry } = await import("./chatRegistry.js");
  for (const chat of chatRegistry.list()) {
    await seedChatUsers(telegram, chat.chatId);
  }
}
