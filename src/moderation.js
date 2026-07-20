import { WARNING_DELETE_SECONDS } from "./config.js";
import { storage } from "./storage.js";
import { topicDiscovery } from "./topicDiscovery.js";
import { parseTopicLink, resolveTopicLink, ALL_THREAD_ID } from "./topicLink.js";
import { isGroupAdmin, isAdminInAnyChat } from "./auth.js";

export const DEFAULT_PURPOSE = "This topic is for admins only.";

export async function canUseBot(telegram, userId) {
  if (userId != null && ADMIN_IDS.has(Number(userId))) return true;
  return isAdminInAnyChat(telegram, userId);
}

export function resolveActorId(ctx) {
  const msg = ctx.message || ctx.channelPost;
  return (
    ctx.from?.id ??
    msg?.from?.id ??
    ctx.callbackQuery?.from?.id ??
    null
  );
}

export async function isPrivileged(telegram, chatId, userId) {
  return isGroupAdmin(telegram, chatId, userId);
}

export async function canManageChat(ctx) {
  const userId = resolveActorId(ctx);
  if (userId != null && (await isPrivileged(ctx.telegram, ctx.chat.id, userId))) {
    return true;
  }

  // Channel posts have no user — only channel admins can post there
  const msg = ctx.message || ctx.channelPost;
  if ((ctx.chat.type === "channel" || msg?.sender_chat?.id === ctx.chat.id) && msg?.text?.startsWith("/")) {
    return true;
  }

  return false;
}

function getTopicName(chatId, threadId) {
  if (threadId === ALL_THREAD_ID) return "All";
  const cached = topicDiscovery.listByChat(chatId).find((t) => t.threadId === threadId);
  if (cached?.name) return cached.name;
  return threadId === 1 ? "General" : `Topic #${threadId}`;
}

export async function verifyBotAccess(telegram, chatId) {
  const me = await telegram.getMe();
  const member = await telegram.getChatMember(chatId, me.id);

  if (member.status !== "administrator") {
    throw new Error("Add the bot to the group/channel and make it an admin first.");
  }

  if (member.can_delete_messages === false) {
    throw new Error("The bot needs the \"Delete messages\" admin permission.");
  }
}

export async function restrictByTopicId(telegram, chatId, threadId, purpose) {
  await verifyBotAccess(telegram, chatId);

  const finalPurpose = purpose || DEFAULT_PURPOSE;

  let chatTitle = String(chatId);
  let username = null;
  try {
    const chat = await telegram.getChat(chatId);
    chatTitle = chat.title || chat.username || chatTitle;
    username = chat.username || null;
  } catch {
    // keep fallback
  }

  const name = getTopicName(chatId, threadId);
  const link =
    username && threadId !== undefined
      ? threadId === ALL_THREAD_ID
        ? `https://t.me/${username}`
        : `https://t.me/${username}/${threadId}`
      : null;
  const updated = storage.isRestricted(chatId, threadId);

  storage.addTopic(chatId, threadId, name, finalPurpose, {
    link,
    chatTitle,
  });

  return {
    chatId,
    threadId,
    username,
    name,
    purpose: finalPurpose,
    chatTitle,
    link,
    updated,
  };
}

export async function restrictByLink(telegram, url, purpose) {
  const parsed = parseTopicLink(url);
  if (!parsed) {
    throw new Error("Invalid topic link.\nExample: https://t.me/pledgefinance/4");
  }

  const finalPurpose = purpose || DEFAULT_PURPOSE;
  const resolved = await resolveTopicLink(telegram, parsed);
  if (!resolved.chatId) {
    throw new Error("Could not resolve chat from link. Is the bot added to that group?");
  }

  await verifyBotAccess(telegram, resolved.chatId);

  let chatTitle = resolved.username || String(resolved.chatId);
  try {
    const chat = await telegram.getChat(resolved.chatId);
    chatTitle = chat.title || chat.username || chatTitle;
  } catch {
    // keep fallback
  }

  const name = getTopicName(resolved.chatId, resolved.threadId);
  const updated = storage.isRestricted(resolved.chatId, resolved.threadId);

  storage.addTopic(resolved.chatId, resolved.threadId, name, finalPurpose, {
    link: resolved.link || url,
    chatTitle,
  });

  return {
    ...resolved,
    name,
    purpose: finalPurpose,
    chatTitle,
    updated,
  };
}

export async function unrestrictByLink(telegram, url) {
  const parsed = parseTopicLink(url);
  if (!parsed) throw new Error("Invalid topic link.");
  const resolved = await resolveTopicLink(telegram, parsed);
  if (!storage.removeTopic(resolved.chatId, resolved.threadId)) {
    throw new Error("That topic is not in your list.");
  }
  return resolved;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWarning(telegram, chatId, threadId, text) {
  const extra = threadId > 0 ? { message_thread_id: threadId } : {};
  try {
    return await telegram.sendMessage(chatId, text, {
      ...extra,
      parse_mode: "HTML",
    });
  } catch (err) {
    if (threadId > 0 && String(err.message).includes("message thread not found")) {
      return telegram.sendMessage(chatId, text, { parse_mode: "HTML" });
    }
    throw err;
  }
}

function resolveModerationThread(msg, chat) {
  if (msg.is_topic_message && msg.message_thread_id) {
    return msg.message_thread_id;
  }
  if (msg.message_thread_id) {
    return msg.message_thread_id;
  }
  // All tab / General — Telegram sends no message_thread_id
  if (storage.isRestricted(chat.id, ALL_THREAD_ID)) return ALL_THREAD_ID;
  if (chat.is_forum && storage.isRestricted(chat.id, 1)) return 1;
  return null;
}

export async function moderateMessage(ctx, msg) {
  const chat = ctx.chat;
  const user = msg.from;

  if (!chat || !user || user.is_bot) return;

  let threadId = resolveModerationThread(msg, chat);
  if (threadId === null) return;

  const topic = storage.getTopic(chat.id, threadId);
  if (!topic) return;
  if (await isPrivileged(ctx.telegram, chat.id, user.id)) return;

  if (msg.new_chat_members || msg.left_chat_member || msg.pinned_message) return;

  try {
    await ctx.telegram.deleteMessage(chat.id, msg.message_id);
  } catch (err) {
    console.error(`Failed to delete message in chat ${chat.id} topic ${threadId}:`, err.message);
    return;
  }

  const purpose = topic.purpose || DEFAULT_PURPOSE;
  const mention = `<a href="tg://user?id=${user.id}">${user.first_name}</a>`;
  const place =
    threadId === ALL_THREAD_ID ? "this channel" : "this topic";
  const warning = await sendWarning(
    ctx.telegram,
    chat.id,
    threadId,
    `⚠️ ${mention}, you cannot send messages in ${place}.\n\n<b>Reason:</b>\n${purpose}`
  );

  sleep(WARNING_DELETE_SECONDS * 1000)
    .then(() => ctx.telegram.deleteMessage(chat.id, warning.message_id))
    .catch(() => {});

  console.log(`Moderated message in chat ${chat.id} topic ${threadId} from user ${user.id}`);
}
