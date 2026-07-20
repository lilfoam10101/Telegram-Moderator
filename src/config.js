import "dotenv/config";

export const BOT_TOKEN = process.env.BOT_TOKEN || "";

export const ADMIN_IDS = new Set(
  (process.env.ADMIN_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^\d+$/.test(id))
    .map(Number)
);

/** Group IDs to check for DM admin access (useful when data/ is empty on Railway). */
export const KNOWN_CHAT_IDS = (process.env.KNOWN_CHAT_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter((id) => /^-?\d+$/.test(id))
  .map(Number);

export const WARNING_DELETE_SECONDS = 15;
