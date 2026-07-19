import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "restricted_topics.json");

class TopicStorage {
  constructor() {
    this.data = this.load();
  }

  load() {
    if (!fs.existsSync(DATA_FILE)) return {};
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  }

  save() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(this.data, null, 2), "utf-8");
  }

  getTopic(chatId, threadId) {
    const topics = this.data[String(chatId)]?.topics || {};
    return topics[String(threadId)] || null;
  }

  isRestricted(chatId, threadId) {
    return this.getTopic(chatId, threadId) !== null;
  }

  addTopic(chatId, threadId, name, purpose, meta = {}) {
    const key = String(chatId);
    if (!this.data[key]) this.data[key] = { topics: {} };
    this.data[key].topics[String(threadId)] = { name, purpose, ...meta };
    this.save();
  }

  updatePurpose(chatId, threadId, purpose) {
    const topic = this.getTopic(chatId, threadId);
    if (!topic) return false;
    topic.purpose = purpose;
    this.save();
    return true;
  }

  removeTopic(chatId, threadId) {
    const key = String(chatId);
    const topics = this.data[key]?.topics || {};
    if (!(String(threadId) in topics)) return false;
    delete topics[String(threadId)];
    if (Object.keys(topics).length === 0) delete this.data[key];
    this.save();
    return true;
  }

  listTopics(chatId) {
    const topics = this.data[String(chatId)]?.topics || {};
    return Object.entries(topics).map(([id, info]) => [
      Number(id),
      info.name,
      info.purpose,
      info.link || null,
    ]);
  }

  listAllTopics() {
    return Object.entries(this.data).flatMap(([chatId, chat]) =>
      Object.entries(chat.topics || {}).map(([threadId, info]) => ({
        chatId: Number(chatId),
        threadId: Number(threadId),
        ...info,
      }))
    );
  }
}

export const storage = new TopicStorage();
