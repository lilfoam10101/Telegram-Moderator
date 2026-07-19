#!/usr/bin/env node
/**
 * Local test for GitHub → Telegram notify bot.
 * Uses NOTIFY_BOT_TOKEN from .env (separate from moderator BOT_TOKEN).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(__dirname, "..", ".env");

function readEnvFile(key) {
  if (!fs.existsSync(ENV_FILE)) return "";
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    if (line.startsWith(`${key}=`)) {
      return line.slice(key.length + 1).trim();
    }
  }
  return "";
}

const TOKEN =
  process.env.NOTIFY_BOT_TOKEN ||
  process.env.TELEGRAM_NOTIFY_BOT_TOKEN ||
  readEnvFile("NOTIFY_BOT_TOKEN");
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || readEnvFile("TELEGRAM_CHAT_ID") || "-1004415462717";
const TOPIC_ID = Number(process.env.TELEGRAM_TOPIC_ID || readEnvFile("TELEGRAM_TOPIC_ID") || "4");

if (!TOKEN) {
  console.error("NOTIFY_BOT_TOKEN is empty.");
  console.error("");
  console.error("1. Open .env and set NOTIFY_BOT_TOKEN=your_notify_bot_token");
  console.error("2. Save the file (Ctrl+S) — unsaved changes are not loaded");
  console.error("3. Run: npm run test:notify");
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOKEN}`;

async function call(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json();
  if (!data.ok) {
    const err = new Error(data.description || JSON.stringify(data));
    err.code = data.error_code;
    err.payload = data;
    throw err;
  }
  return data;
}

function explainSendError(err) {
  const desc = err.message || "";
  if (desc.includes("chat not found")) {
    return "Bot belum join grup, atau TELEGRAM_CHAT_ID salah.";
  }
  if (desc.includes("not enough rights")) {
    return "Bot sudah di grup tapi tidak punya izin kirim pesan di topic ini.";
  }
  if (desc.includes("thread not found")) {
    return "TELEGRAM_TOPIC_ID salah — cek angka di link t.me/pledgefinance/4 → pakai 4.";
  }
  if (desc.includes("Unauthorized")) {
    return "NOTIFY_BOT_TOKEN salah atau dicabut — buat ulang di @BotFather.";
  }
  return desc;
}

const me = await call("getMe", {});
console.log("Notify bot:", `@${me.result.username}`);

try {
  await call("getChat", { chat_id: CHAT_ID });
  console.log("Chat OK:", CHAT_ID);
} catch (err) {
  console.error("getChat failed:", explainSendError(err));
  console.error("→ Tambahkan bot notify ke grup Pledge Finance dulu.");
  process.exit(1);
}

const text =
  "🔄 <b>Test notification</b>\n\nIf you see this, the notify bot works.\n\n<b>Chat:</b> " +
  CHAT_ID +
  "\n<b>Topic:</b> " +
  TOPIC_ID;

try {
  const sent = await call("sendMessage", {
    chat_id: CHAT_ID,
    message_thread_id: TOPIC_ID,
    parse_mode: "HTML",
    text,
  });
  console.log("Sent to topic. message_id:", sent.result.message_id);
} catch (err) {
  console.error("Send to topic failed:", explainSendError(err));
  try {
    const sent = await call("sendMessage", {
      chat_id: CHAT_ID,
      parse_mode: "HTML",
      text: text + "\n\n(fallback: general chat — periksa TELEGRAM_TOPIC_ID)",
    });
    console.log("Sent to general chat. message_id:", sent.result.message_id);
  } catch (err2) {
    console.error("Send failed:", explainSendError(err2));
    process.exit(1);
  }
}
