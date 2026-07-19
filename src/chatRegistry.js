import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "data", "chats.json");

class ChatRegistry {
  constructor() {
    this.data = this.load();
  }

  load() {
    if (!fs.existsSync(DATA_FILE)) return { chats: {} };
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  }

  save() {
    const dir = path.dirname(DATA_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), "utf-8");
  }

  upsert(chatId, info) {
    this.data.chats[String(chatId)] = {
      ...this.data.chats[String(chatId)],
      ...info,
      chatId: Number(chatId),
      updatedAt: new Date().toISOString(),
    };
    this.save();
  }

  remove(chatId) {
    delete this.data.chats[String(chatId)];
    this.save();
  }

  get(chatId) {
    return this.data.chats[String(chatId)] || null;
  }

  list() {
    return Object.values(this.data.chats);
  }

  upsertFromMember(chat, member) {
    const chatId = chat.id;
    if (member.status === "left" || member.status === "kicked") {
      this.remove(chatId);
      return null;
    }

    const info = {
      title: chat.title || chat.username || String(chatId),
      username: chat.username || null,
      type: chat.type,
      status: member.status,
      canDeleteMessages: member.can_delete_messages ?? null,
      canManageTopics: member.can_manage_topics ?? null,
    };

    this.upsert(chatId, info);
    return info;
  }
}

export const chatRegistry = new ChatRegistry();

export async function refreshChatStatus(telegram, chatId) {
  const me = await telegram.getMe();
  let chat;
  let member;

  try {
    chat = await telegram.getChat(chatId);
    member = await telegram.getChatMember(chatId, me.id);
  } catch {
    chatRegistry.remove(chatId);
    return null;
  }

  return chatRegistry.upsertFromMember(chat, member);
}

export async function refreshAllChats(telegram) {
  const chats = chatRegistry.list();
  const results = [];

  for (const chat of chats) {
    const updated = await refreshChatStatus(telegram, chat.chatId);
    if (updated) results.push(updated);
  }

  return results;
}

export function isAdminReady(chat) {
  return (
    chat.status === "administrator" &&
    chat.canDeleteMessages !== false
  );
}
