import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "data", "welcome.json");

export const DEFAULT_WELCOME =
  "Welcome, {mention}! Glad to have you in {group}.";

class WelcomeStorage {
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

  get(chatId) {
    const entry = this.data[String(chatId)];
    if (entry?.enabled === false) return null;
    return entry?.message || DEFAULT_WELCOME;
  }

  set(chatId, message) {
    this.data[String(chatId)] = {
      enabled: true,
      message: message.trim(),
      updatedAt: new Date().toISOString(),
    };
    this.save();
  }

  remove(chatId) {
    this.data[String(chatId)] = {
      enabled: false,
      updatedAt: new Date().toISOString(),
    };
    this.save();
    return true;
  }

  isEnabled(chatId) {
    return this.get(String(chatId)) != null;
  }

  preview(chatId) {
    const entry = this.data[String(chatId)];
    if (entry?.enabled === false) return null;
    return entry?.message || DEFAULT_WELCOME;
  }
}

export const welcomeStorage = new WelcomeStorage();
