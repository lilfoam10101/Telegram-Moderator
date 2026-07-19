import { chatRegistry } from "./chatRegistry.js";

export const BOT_COMMANDS = [
  { command: "start", description: "Open setup menu" },
  { command: "menu", description: "Open setup menu" },
  { command: "help", description: "Setup guide" },
];

export const GROUP_COMMANDS = [
  { command: "help", description: "Show group command list" },
  { command: "filter", description: "Set auto-reply trigger" },
  { command: "unfilter", description: "Remove auto-reply trigger" },
  { command: "filters", description: "List auto-reply triggers" },
  { command: "mute", description: "Mute member (reply to message)" },
  { command: "unmute", description: "Unmute member (reply to message)" },
  { command: "ban", description: "Ban member (reply to message)" },
  { command: "unban", description: "Unban member (reply or user ID)" },
  { command: "kick", description: "Kick member (reply to message)" },
  { command: "setwelcome", description: "Set new member welcome message" },
  { command: "welcome", description: "Show welcome message settings" },
  { command: "unwelcome", description: "Disable welcome message" },
  { command: "myid", description: "Show your Telegram user ID" },
];

export const GROUP_HELP_TEXT =
  "📋 *Group commands*\n\n" +
  "`/help` — Show this list\n" +
  "`/filter <trigger> <response>` — Set auto\\-reply\n" +
  "`/unfilter <trigger>` — Remove auto\\-reply\n" +
  "`/filters` — List auto\\-reply triggers\n" +
  "`/mute` — Mute member \\(tap @ and pick from list\\)\n" +
  "`/unmute` — Unmute member \\(tap @ and pick from list\\)\n" +
  "`/ban` — Ban member \\(tap @ and pick from list\\)\n" +
  "`/unban` — Unban member \\(tap @ and pick from list\\)\n" +
  "`/kick` — Kick member \\(tap @ and pick from list\\)\n" +
  "`/setwelcome <message>` — Set new member welcome\n" +
  "`/welcome` — Show welcome settings\n" +
  "`/unwelcome` — Disable welcome message\n" +
  "`/myid` — Show your Telegram user ID\n\n" +
  "_Welcome placeholders: {name} {username} {mention} {group}_\n\n" +
  "_Filter and moderation commands require group admin\\._";

function isGroupOrChannel(ctx) {
  const type = ctx.chat?.type;
  return type === "group" || type === "supergroup" || type === "channel";
}

export async function registerGroupCommandsForChat(telegram, chatId) {
  await telegram.setMyCommands(GROUP_COMMANDS, {
    scope: { type: "chat", chat_id: chatId },
  });
  await telegram.setMyCommands(GROUP_COMMANDS, {
    scope: { type: "chat_administrators", chat_id: chatId },
  });
}

export async function registerAllKnownGroupCommands(telegram) {
  const chats = chatRegistry.list().filter(
    (c) => c.type === "group" || c.type === "supergroup" || c.type === "channel"
  );

  for (const chat of chats) {
    try {
      await registerGroupCommandsForChat(telegram, chat.chatId);
    } catch (err) {
      console.warn(`Failed to register commands for chat ${chat.chatId}:`, err.message);
    }
  }
}

export async function registerBotCommands(telegram) {
  await telegram.setMyCommands(GROUP_COMMANDS, {
    scope: { type: "default" },
  });

  await telegram.setMyCommands(BOT_COMMANDS, {
    scope: { type: "all_private_chats" },
  });

  await telegram.setMyCommands(GROUP_COMMANDS, {
    scope: { type: "all_group_chats" },
  });

  await telegram.setMyCommands(GROUP_COMMANDS, {
    scope: { type: "all_chat_administrators" },
  });

  await registerAllKnownGroupCommands(telegram);

  console.log("Bot command suggestions registered.");
}

async function handleGroupHelp(ctx) {
  if (!isGroupOrChannel(ctx)) return;
  await ctx.reply(GROUP_HELP_TEXT, { parse_mode: "MarkdownV2" });
}

export function registerGroupHelpHandler(bot) {
  bot.command("help", async (ctx, next) => {
    if (!isGroupOrChannel(ctx)) return next();
    await handleGroupHelp(ctx);
  });

  bot.on("channel_post", async (ctx, next) => {
    const text = ctx.channelPost?.text || "";
    if (!text.match(/^\/help(?:@[\w_]+)?(?:\s|$)/i)) return next();
    await handleGroupHelp(ctx);
  });
}
