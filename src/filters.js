import { filterStorage } from "./filterStorage.js";
import { canManageChat, resolveActorId } from "./moderation.js";
import { buildFilterReplyPayload } from "./filterReply.js";
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

function parseFilterCommand(text) {
  const match = text.match(/^\/filter(?:@[\w_]+)?\s+(\S+)\s+([\s\S]+)$/i);
  if (!match) return null;
  return { trigger: match[1], response: match[2].trim() };
}

function parseUnfilterCommand(text) {
  const match = text.match(/^\/unfilter(?:@[\w_]+)?\s+(\S+)/i);
  if (!match) return null;
  return { trigger: match[1] };
}

function isGroupOrChannel(ctx) {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup" || ctx.chat?.type === "channel";
}

function getMessageText(ctx) {
  return ctx.message?.text || ctx.channelPost?.text || "";
}

async function denyFilterAccess(ctx) {
  await ctx.reply("Only group admins can manage filters.");
}

async function handleFilter(ctx) {
  if (!isGroupOrChannel(ctx)) return;
  if (!(await canManageChat(ctx))) {
    await denyFilterAccess(ctx);
    return;
  }

  const parsed = parseFilterCommand(getMessageText(ctx));
  if (!parsed) {
    await replyEphemeral(
      ctx,
      "Usage: /filter <trigger> <response>\nExample: /filter ca 0x93874923874928374"
    );
    return;
  }

  filterStorage.set(ctx.chat.id, parsed.trigger, parsed.response);
  await replyEphemeral(ctx, "Filter saved.");
}

async function handleUnfilter(ctx) {
  if (!isGroupOrChannel(ctx)) return;
  if (!(await canManageChat(ctx))) {
    await denyFilterAccess(ctx);
    return;
  }

  const parsed = parseUnfilterCommand(getMessageText(ctx));
  if (!parsed) {
    await replyEphemeral(ctx, "Usage: /unfilter <trigger>\nExample: /unfilter ca");
    return;
  }

  if (!filterStorage.remove(ctx.chat.id, parsed.trigger)) {
    await replyEphemeral(ctx, "Filter not found.");
    return;
  }

  await replyEphemeral(ctx, "Filter removed.");
}

async function handleFiltersList(ctx) {
  if (!isGroupOrChannel(ctx)) return;
  if (!(await canManageChat(ctx))) {
    await denyFilterAccess(ctx);
    return;
  }

  const filters = filterStorage.list(ctx.chat.id);
  if (filters.length === 0) {
    await replyEphemeral(ctx, "No filters configured.");
    return;
  }

  const lines = filters.map((f, i) => {
    const items = f.responses || (f.response ? [f.response] : []);
    return `${i + 1}. "${f.trigger}" → ${items.join(" | ")}`;
  });
  await replyEphemeral(ctx, `Active filters (${filters.length}):\n\n${lines.join("\n")}`);
}

export function registerFilterHandlers(bot) {
  bot.command("filter", handleFilter);
  bot.command("unfilter", handleUnfilter);
  bot.command("filters", handleFiltersList);

  bot.command("myid", async (ctx) => {
    if (ctx.chat.type === "private") return;
    const userId = resolveActorId(ctx);
    if (userId) {
      await ctx.reply(`Your Telegram ID: ${userId}`);
    } else {
      await ctx.reply("Could not detect your user ID from this message.");
    }
  });

  bot.on("channel_post", async (ctx, next) => {
    const text = ctx.channelPost?.text || "";
    if (!text.startsWith("/")) return next();

    const cmd = text.split(/\s/)[0].split("@")[0].toLowerCase();
    if (cmd === "/filter") return handleFilter(ctx);
    if (cmd === "/unfilter") return handleUnfilter(ctx);
    if (cmd === "/filters") return handleFiltersList(ctx);
    return next();
  });
}

function shouldTriggerFilter(msg) {
  if (!msg?.text || msg.text.startsWith("/")) return false;
  // Channel / group identity posts (Send as channel, linked channel, anonymous)
  if (msg.sender_chat) return true;
  if (!msg.from || msg.from.is_bot) return false;
  return true;
}

async function sendFilterReply(telegram, chatId, msg, payload) {
  const extra = {};
  if (msg.message_thread_id) extra.message_thread_id = msg.message_thread_id;

  const withMarkup = {
    ...extra,
    parse_mode: payload.parse_mode,
    ...(payload.reply_markup && { reply_markup: payload.reply_markup }),
  };

  const withoutMarkup = {
    ...extra,
    parse_mode: payload.parse_mode,
  };

  const attempts = [];
  if (!msg.sender_chat) {
    attempts.push({ ...withMarkup, reply_parameters: { message_id: msg.message_id } });
  }
  attempts.push(withMarkup, withoutMarkup, extra);

  for (const options of attempts) {
    try {
      await telegram.sendMessage(chatId, payload.text, options);
      return true;
    } catch (err) {
      const reason = err.response?.description || err.message;
      console.warn(`Filter send attempt failed in ${chatId}: ${reason}`);
    }
  }
  return false;
}

export async function handleFilterTrigger(ctx, msg) {
  if (!shouldTriggerFilter(msg)) return false;
  if (msg.from) userRegistry.remember(ctx.chat.id, msg.from);

  const trigger = msg.text.trim().toLowerCase();
  if (!trigger) return false;

  const responses = filterStorage.getResponses(ctx.chat.id, trigger);
  if (responses.length === 0) return false;

  const payload = buildFilterReplyPayload(responses);
  const ok = await sendFilterReply(ctx.telegram, ctx.chat.id, msg, payload);

  if (!ok) {
    console.error(
      `Filter reply failed in chat ${ctx.chat.id} (from=${msg.from?.id ?? "none"}, sender_chat=${msg.sender_chat?.id ?? "none"})`
    );
    return false;
  }

  const actor = msg.sender_chat
    ? `channel:${msg.sender_chat.id}`
    : String(msg.from?.id ?? "unknown");

  console.log(
    `Filter "${trigger}" triggered in chat ${ctx.chat.id} by ${actor} (${responses.length} response(s))`
  );
  return true;
}
