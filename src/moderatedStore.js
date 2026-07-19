import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "data", "moderated_members.json");

class ModeratedStore {
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
    const key = String(chatId);
    if (!this.data[key]) this.data[key] = {};

    const entry = {
      id: user.id,
      first_name: user.first_name || null,
      username: user.username || null,
      updatedAt: new Date().toISOString(),
    };

    this.data[key][String(user.id)] = entry;
    if (user.username) {
      this.data[key][user.username.toLowerCase()] = entry;
    }
    this.save();
  }

  getByUsername(chatId, username) {
    const chat = this.data[String(chatId)];
    if (!chat) return null;
    return chat[username.toLowerCase()] || null;
  }

  getAllUserIds(chatId) {
    const chat = this.data[String(chatId)];
    if (!chat) return [];
    const ids = new Set();
    for (const entry of Object.values(chat)) {
      if (entry?.id) ids.add(entry.id);
    }
    return [...ids];
  }
}

export const moderatedStore = new ModeratedStore();

export async function refreshModeratedMembers(telegram, chatId) {
  for (const userId of moderatedStore.getAllUserIds(chatId)) {
    try {
      const member = await telegram.getChatMember(chatId, userId);
      if (member.user) moderatedStore.remember(chatId, member.user);
    } catch {
      // member may have left
    }
  }
}
