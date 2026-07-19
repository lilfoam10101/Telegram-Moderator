import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "data", "filters.json");

class FilterStorage {
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

  _chat(chatId) {
    const key = String(chatId);
    if (!this.data[key]) this.data[key] = { filters: {} };
    return this.data[key];
  }

  set(chatId, trigger, response) {
    const key = trigger.toLowerCase();
    const chat = this._chat(chatId);
    if (!chat.filters[key]) {
      chat.filters[key] = { trigger: key, responses: [] };
    }

    const entry = chat.filters[key];
    if (entry.response && !entry.responses) {
      entry.responses = [entry.response];
      delete entry.response;
    }
    if (!entry.responses.includes(response)) {
      entry.responses.push(response);
    }
    entry.updatedAt = new Date().toISOString();
    this.save();
  }

  getResponses(chatId, trigger) {
    const entry = this._chat(chatId).filters[trigger.toLowerCase()];
    if (!entry) return [];
    if (entry.responses?.length) return entry.responses;
    if (entry.response) return [entry.response];
    return [];
  }

  get(chatId, trigger) {
    const responses = this.getResponses(chatId, trigger);
    if (responses.length === 0) return null;
    return { trigger: trigger.toLowerCase(), responses };
  }

  remove(chatId, trigger) {
    const entry = this._chat(chatId);
    const key = trigger.toLowerCase();
    if (!(key in entry.filters)) return false;
    delete entry.filters[key];
    if (Object.keys(entry.filters).length === 0) delete this.data[String(chatId)];
    this.save();
    return true;
  }

  list(chatId) {
    return Object.values(this._chat(chatId).filters || {});
  }
}

export const filterStorage = new FilterStorage();
