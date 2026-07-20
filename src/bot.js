import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { BOT_TOKEN } from "./config.js";
import { moderateMessage } from "./moderation.js";
import { registerSetupHandlers } from "./setup.js";
import { registerFilterHandlers, handleFilterTrigger } from "./filters.js";
import { registerMemberActionHandlers } from "./memberActions.js";
import { registerGroupHelpHandler, registerGroupCommandsForChat } from "./commands.js";
import { registerWelcomeHandlers, handleNewChatMembers, handleChatMemberJoin } from "./welcome.js";
import { registerStocksHandlers } from "./stocks.js";
import { discoverTopicFromMessage } from "./topicDiscovery.js";
import { rememberMessageUser, rememberChatMember } from "./userRegistry.js";
import { moderatedStore } from "./moderatedStore.js";
import { refreshChatStatus } from "./chatRegistry.js";

export function createBot() {
  if (!BOT_TOKEN) {
    throw new Error("BOT_TOKEN is not set.");
  }

  const bot = new Telegraf(BOT_TOKEN);

  bot.catch(async (err, ctx) => {
    console.error("Bot handler error:", err.message);
    try {
      if (ctx.chat?.type === "private") {
        await ctx.reply("Something went wrong. Please try /start again.");
      }
    } catch {
      // ignore secondary failures
    }
  });

  const commandsSynced = new Set();

  bot.use(async (ctx, next) => {
    const msg = ctx.message || ctx.channelPost;
    if (ctx.chat?.type === "private") {
      const text = msg?.text ? ` text="${msg.text.slice(0, 40)}"` : "";
      console.log(`DM: ${ctx.updateType} user=${ctx.from?.id}${text}`);
      return next();
    }
    if (ctx.chat?.id) {
      refreshChatStatus(ctx.telegram, ctx.chat.id).catch(() => {});
      if (!commandsSynced.has(ctx.chat.id)) {
        commandsSynced.add(ctx.chat.id);
        registerGroupCommandsForChat(ctx.telegram, ctx.chat.id)
          .then(() => console.log(`Commands synced for chat ${ctx.chat.id}`))
          .catch((err) => {
            console.warn(`Command sync failed for ${ctx.chat.id}:`, err.message);
          });
      }
    }
    if (msg) rememberMessageUser(ctx.chat.id, msg);
    const chat = ctx.chat?.title || ctx.chat?.username || ctx.chat?.id || "unknown";
    const actor = msg?.sender_chat?.title || msg?.from?.first_name || "unknown";
    const via = msg?.sender_chat ? ` via ${msg.sender_chat.type}:${msg.sender_chat.id}` : "";
    const text = msg?.text ? ` text="${msg.text.slice(0, 40)}"` : "";
    console.log(`Update: ${ctx.updateType} from ${chat} (${actor}${via})${text}`);
    return next();
  });

  registerSetupHandlers(bot);
  registerGroupHelpHandler(bot);
  registerFilterHandlers(bot);
  registerMemberActionHandlers(bot);
  registerWelcomeHandlers(bot);
  registerStocksHandlers(bot);

  bot.on("chat_member", async (ctx) => {
    if (ctx.chat?.type === "private") return;
    const member = ctx.chatMember?.new_chat_member;
    rememberChatMember(ctx.chat.id, member);
    if (member?.user && (member.status === "restricted" || member.status === "kicked")) {
      moderatedStore.remember(ctx.chat.id, member.user);
    }
    await handleChatMemberJoin(ctx);
  });

  // Groups/channels: filters + moderation
  bot.on(message(), async (ctx, next) => {
    if (ctx.chat.type === "private") return next();
    if (ctx.message) {
      if (ctx.message.new_chat_members?.length) {
        await handleNewChatMembers(ctx, ctx.message);
      }
      await discoverTopicFromMessage(ctx.telegram, ctx.message, ctx.chat);
      await handleFilterTrigger(ctx, ctx.message);
      await moderateMessage(ctx, ctx.message);
    }
  });

  bot.on("channel_post", async (ctx) => {
    if (ctx.channelPost) {
      await discoverTopicFromMessage(ctx.telegram, ctx.channelPost, ctx.chat);
      await handleFilterTrigger(ctx, ctx.channelPost);
      await moderateMessage(ctx, ctx.channelPost);
    }
  });

  return bot;
}
