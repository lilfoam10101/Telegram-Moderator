#!/usr/bin/env node
/**
 * Local test for GitHub → Telegram notify bot.
 * Usage: set env vars then run:
 *   NOTIFY_BOT_TOKEN=... CHAT_ID=-100... TOPIC_ID=4 node scripts/test-notify.js
 */
import "dotenv/config";

const TOKEN =
  process.env.NOTIFY_BOT_TOKEN ||
  process.env.TELEGRAM_NOTIFY_BOT_TOKEN ||
  process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID || process.env.TELEGRAM_CHAT_ID || "-1004415462717";
const TOPIC_ID = Number(process.env.TOPIC_ID || process.env.TELEGRAM_TOPIC_ID || "4");

if (!TOKEN) {
  console.error("Set NOTIFY_BOT_TOKEN (notify bot token, NOT moderator bot).");
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOKEN}`;

async function call(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(JSON.stringify(data));
  return data;
}

const me = await call("getMe", {});
console.log("Bot:", `@${me.result.username}`);

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
  console.warn("Topic failed:", err.message);
  const sent = await call("sendMessage", {
    chat_id: CHAT_ID,
    parse_mode: "HTML",
    text: text + "\n\n(was sent to general — check TOPIC_ID)",
  });
  console.log("Sent to general chat. message_id:", sent.result.message_id);
}
