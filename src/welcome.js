import { welcomeStorage, DEFAULT_WELCOME } from "./welcomeStorage.js";
import { canManageChat } from "./moderation.js";
import { userRegistry } from "./userRegistry.js";

const CONFIRM_DELETE_SECONDS = 5;

function scheduleDelete(telegram, chatId, messageId, seconds = CONFIRM_DELETE_SECONDS) {
  setTimeout(() => {
    telegram.deleteMessage(chatId, messageId).catch(() => {});
  }, seconds * 1000);
}

async function replyEphemeral(ctx, text) {
  const sent = await ctx.reply(text);
  scheduleDelete(ctx.telegram, ctx.chat.id, sent.message_id);

  const source = ctx.message || ctx.channelPost;
  if (source?.message_id) {
    scheduleDelete(ctx.telegram, ctx.chat.id, source.message_id);
  }
}

function isGroupChat(ctx) {
  const type = ctx.chat?.type;
  return type === "group" || type === "supergroup";
}

function getMessageText(ctx) {
  return ctx.message?.text || ctx.channelPost?.text || "";
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderWelcome(template, user, chat) {
  const name = escapeHtml(user.first_name || "there");
  const username = user.username ? `@${user.username}` : name;
  const mention = `<a href="tg://user?id=${user.id}">${name}</a>`;
  const group = escapeHtml(chat.title || chat.username || "this group");

  return template
    .replace(/\{name\}/g, name)
    .replace(/\{username\}/g, escapeHtml(username))
    .replace(/\{mention\}/g, mention)
    .replace(/\{group\}/g, group);
}

function parseSetWelcomeCommand(text) {
  const match = text.match(/^\/setwelcome(?:@[\w_]+)?(?:\s+([\s\S]+))?$/i);
  if (!match) return null;
  return { message: match[1]?.trim() || null };
}

async function sendWelcome(ctx, user, threadId = null) {
  if (!user || user.is_bot) return false;

  const template = welcomeStorage.get(ctx.chat.id);
  if (!template) return false;

  userRegistry.remember(ctx.chat.id, user);

  const text = renderWelcome(template, user, ctx.chat);
  const extra = { parse_mode: "HTML" };
  if (threadId) extra.message_thread_id = threadId;

  try {
    await ctx.telegram.sendMessage(ctx.chat.id, text, extra);
    console.log(`Welcome sent in chat ${ctx.chat.id} for user ${user.id}`);
    return true;
  } catch (err) {
    if (threadId) {
      try {
        await ctx.telegram.sendMessage(ctx.chat.id, text, { parse_mode: "HTML" });
        return true;
      } catch {
        // fall through
      }
    }
    console.error(`Welcome failed in chat ${ctx.chat.id}:`, err.message);
    return false;
  }
}

export async function handleNewChatMembers(ctx, msg) {
  const members = msg.new_chat_members;
  if (!members?.length) return;

  const threadId = msg.message_thread_id || null;
  for (const user of members) {
    await sendWelcome(ctx, user, threadId);
  }
}

export async function handleChatMemberJoin(ctx) {
  const update = ctx.chatMember;
  if (!update) return;

  const oldStatus = update.old_chat_member?.status;
  const newStatus = update.new_chat_member?.status;
  const user = update.new_chat_member?.user;

  const joined =
    (oldStatus === "left" || oldStatus === "kicked") &&
    (newStatus === "member" || newStatus === "administrator");

  if (!joined) return;
  await sendWelcome(ctx, user, msgThreadId(ctx));
}

function msgThreadId(ctx) {
  return ctx.message?.message_thread_id || null;
}

async function handleSetWelcome(ctx) {
  if (!isGroupChat(ctx)) return;
  if (!(await canManageChat(ctx))) {
    await ctx.reply("Only group admins can manage welcome messages.");
    return;
  }

  const parsed = parseSetWelcomeCommand(getMessageText(ctx));
  if (!parsed?.message) {
    await replyEphemeral(
      ctx,
      "Usage: /setwelcome <message>\n\n" +
        "Placeholders: {name} {username} {mention} {group}\n\n" +
        `Example: /setwelcome Welcome, {mention}! Read the rules in {group}.`
    );
    return;
  }

  welcomeStorage.set(ctx.chat.id, parsed.message);
  await replyEphemeral(ctx, "Welcome message saved.");
}

async function handleShowWelcome(ctx) {
  if (!isGroupChat(ctx)) return;
  if (!(await canManageChat(ctx))) {
    await ctx.reply("Only group admins can manage welcome messages.");
    return;
  }

  if (!welcomeStorage.isEnabled(ctx.chat.id)) {
    await replyEphemeral(ctx, "Welcome is disabled. Use /setwelcome to enable.");
    return;
  }

  const message = welcomeStorage.preview(ctx.chat.id);
  await replyEphemeral(ctx, `Current welcome:\n\n${message}`);
}

async function handleUnsetWelcome(ctx) {
  if (!isGroupChat(ctx)) return;
  if (!(await canManageChat(ctx))) {
    await ctx.reply("Only group admins can manage welcome messages.");
    return;
  }

  if (!welcomeStorage.remove(ctx.chat.id)) {
    await replyEphemeral(ctx, "Welcome was not enabled.");
    return;
  }

  await replyEphemeral(ctx, "Welcome message disabled.");
}

export function registerWelcomeHandlers(bot) {
  bot.command("setwelcome", handleSetWelcome);
  bot.command("welcome", handleShowWelcome);
  bot.command("unwelcome", handleUnsetWelcome);

  bot.on("channel_post", async (ctx, next) => {
    const text = ctx.channelPost?.text || "";
    const cmd = text.split(/\s/)[0].split("@")[0].toLowerCase();
    if (cmd === "/setwelcome") return handleSetWelcome(ctx);
    if (cmd === "/welcome") return handleShowWelcome(ctx);
    if (cmd === "/unwelcome") return handleUnsetWelcome(ctx);
    return next();
  });
}
