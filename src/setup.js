import { Markup } from "telegraf";
import { clearSession, getSession, setSession } from "./session.js";
import { storage } from "./storage.js";
import { restrictByTopicId, canUseBot, verifyBotAccess, DEFAULT_PURPOSE } from "./moderation.js";
import { chatRegistry, refreshAllChats, isAdminReady } from "./chatRegistry.js";
import {
  getAddToGroupUrl,
  getAddToChannelUrl,
  getGroupOpenUrl,
  getBotDmUrl,
  getBotUsername,
} from "./botLinks.js";
import {
  topicDiscovery,
  extractForwardedTopic,
  topicButtonLabel,
} from "./topicDiscovery.js";
import { extractTopicUrls, parseTopicLink, resolveTopicLink } from "./topicLink.js";
import { registerGroupCommandsForChat } from "./commands.js";
import { seedChatUsers } from "./userRegistry.js";

export const MAIN_MENU = Markup.keyboard([
  ["🔗 Add to Group", "➕ Add Topic"],
  ["📋 My Topics", "✏️ Edit Purpose"],
  ["❌ Remove Topic", "ℹ️ Setup Guide"],
])
  .resize()
  .persistent();

export const WELCOME_TEXT =
  "🤖 *Telegram Topic Moderator*\n\n" +
  "Manage read\\-only topics across multiple groups/channels — all from here\\.\n\n" +
  "*Quick start:*\n" +
  "1\\. Tap *🔗 Add to Group* and add the bot as admin\n" +
  "2\\. You'll get a message here automatically\n" +
  "3\\. Tap *➕ Add Topic* and paste topic link\\(s\\)\n\n" +
  "No setup needed inside the group\\.";

export const GUIDE_TEXT =
  "ℹ️ *Setup Guide*\n\n" +
  "*Step 1 — Add the bot*\n" +
  "Tap 🔗 Add to Group → choose Group or Channel\n\n" +
  "*Step 2 — Grant admin rights*\n" +
  "When adding, enable *Delete messages*\n\n" +
  "*Step 3 — Add topics*\n" +
  "Tap ➕ Add Topic → paste one or more topic links\n\n" +
  "*Link examples:*\n" +
  "`https://t.me/pledgefinance/4` \\(specific topic\\)\n" +
  "`https://t.me/pledgefinance` \\(All tab / main feed\\)\n" +
  "`https://t.me/c/1234567890/4`\n\n" +
  "Send multiple links at once \\(one per line\\)\\. " +
  "You can also forward a message from a topic\\.";

function unauthorized(ctx) {
  return ctx.reply("⛔ Only group admins can use this bot.\n\nAdd the bot to your group and make it admin first.");
}

async function guardPrivateAdmin(ctx) {
  if (ctx.chat.type !== "private") return false;
  if (!(await canUseBot(ctx.telegram, ctx.from?.id))) {
    await unauthorized(ctx);
    return false;
  }
  return true;
}

async function guardCallbackAdmin(ctx) {
  if (!(await canUseBot(ctx.telegram, ctx.from?.id))) {
    await ctx.answerCbQuery("Unauthorized");
    return false;
  }
  return true;
}

function readyGroups() {
  return chatRegistry.list().filter(isAdminReady);
}

export async function showMainMenu(ctx, text = WELCOME_TEXT) {
  await ctx.reply(text, { parse_mode: "MarkdownV2", ...MAIN_MENU });
}

async function buildAddGroupKeyboard(telegram) {
  const username = await getBotUsername(telegram);
  return Markup.inlineKeyboard([
    [Markup.button.url("➕ Add to Group (as Admin)", getAddToGroupUrl(username))],
    [Markup.button.url("📢 Add to Channel (as Admin)", getAddToChannelUrl(username))],
    [Markup.button.callback("🔄 Check Groups", "check_groups")],
  ]);
}

async function sendGroupsStatus(ctx, { edit = false } = {}) {
  await refreshAllChats(ctx.telegram);
  const chats = chatRegistry.list();
  const username = await getBotUsername(ctx.telegram);

  let text =
    "🔗 *Add to Group / Channel*\n\n" +
    "Use the buttons below to add this bot\\. " +
    "When prompted, grant *Delete messages* permission\\.\n\n";

  if (chats.length === 0) {
    text += "No groups connected yet\\. Add the bot using the buttons below\\.";
  } else {
    text += `*Connected \\(${chats.length}\\):*\n`;
    for (const chat of chats) {
      const status = isAdminReady(chat) ? "✅" : "⚠️";
      const line = `${status} ${chat.title.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&")}`;
      text += `\n${line}`;
      if (!isAdminReady(chat)) {
        if (chat.status === "member") text += " · not admin";
        else if (chat.canDeleteMessages === false) text += " · no delete permission";
      }
    }
    text += "\n\n⚠️ = action needed\\. Tap the group below to fix\\.";
  }

  const keyboard = [
    [Markup.button.url("➕ Add to Group (as Admin)", getAddToGroupUrl(username))],
    [Markup.button.url("📢 Add to Channel (as Admin)", getAddToChannelUrl(username))],
    [Markup.button.callback("🔄 Refresh Status", "check_groups")],
  ];

  for (const chat of chats) {
    if (!isAdminReady(chat)) {
      const openUrl = getGroupOpenUrl(chat.username);
      if (openUrl) {
        keyboard.push([
          Markup.button.url(`⚙️ Fix: ${chat.title.slice(0, 28)}`, openUrl),
        ]);
      }
    }
  }

  const markup = Markup.inlineKeyboard(keyboard);

  if (edit && ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: "MarkdownV2", ...markup });
  } else {
    await ctx.reply(text, { parse_mode: "MarkdownV2", ...markup });
  }
}

async function startAddTopicFlow(ctx) {
  setSession(ctx.from.id, { step: "add_link" });
  await ctx.reply(
    "Send topic link(s) to restrict.\n\n" +
      "Examples:\n" +
      "https://t.me/pledgefinance/4  (specific topic)\n" +
      "https://t.me/pledgefinance     (All tab)\n" +
      "https://t.me/c/1234567890/4\n\n" +
      "Multiple links? Send one per line.\n" +
      "Or forward a message from inside the topic.",
    Markup.inlineKeyboard([[Markup.button.callback("« Cancel", "cancel_add")]])
  );
}

async function resolvePendingTopics(telegram, urls) {
  const pending = [];
  const errors = [];
  const skipped = [];

  for (const url of urls) {
    const parsed = parseTopicLink(url);
    if (!parsed) {
      errors.push(`Invalid link: ${url}`);
      continue;
    }

    try {
      const resolved = await resolveTopicLink(telegram, parsed);
      if (!resolved.chatId) {
        errors.push(`Could not resolve chat: ${url}`);
        continue;
      }

      await verifyBotAccess(telegram, resolved.chatId);

      if (storage.isRestricted(resolved.chatId, resolved.threadId)) {
        skipped.push(url);
        continue;
      }

      pending.push({
        chatId: resolved.chatId,
        threadId: resolved.threadId,
        link: resolved.link || url,
        username: resolved.username,
      });
    } catch (err) {
      errors.push(`${url}\n  → ${err.message}`);
    }
  }

  return { pending, errors, skipped };
}

function purposePromptKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("⏭ Skip (use default)", "skip_purpose")],
    [Markup.button.callback("« Cancel", "cancel_add")],
  ]);
}

function normalizePurpose(text) {
  const trimmed = text?.trim();
  if (!trimmed || trimmed === "-" || /^skip$/i.test(trimmed)) return DEFAULT_PURPOSE;
  return trimmed;
}

async function completeAddTopics(ctx, pending, purpose) {
  const finalPurpose = normalizePurpose(purpose);

  const results = [];
  for (const item of pending) {
    const result = await restrictByTopicId(
      ctx.telegram,
      item.chatId,
      item.threadId,
      finalPurpose
    );
    topicDiscovery.register(item.chatId, item.threadId, result.name, result.chatTitle);
    results.push(result);
  }

  clearSession(ctx.from.id);

  const lines = results.map(
    (r) => `✅ ${r.chatTitle} / ${r.name}\n   ${r.link || `topic #${r.threadId}`}`
  );

  const purposeLine =
    finalPurpose === DEFAULT_PURPOSE
      ? `Default reason:\n${DEFAULT_PURPOSE}`
      : `Purpose:\n${finalPurpose}`;

  await ctx.reply(
    `${results.length} topic(s) added!\n\n${lines.join("\n\n")}\n\n${purposeLine}`,
    Markup.inlineKeyboard([[Markup.button.callback("➕ Add Another Topic", "add_another_topic")]])
  );
  await ctx.reply("Back to menu:", MAIN_MENU);
}

async function sendRestrictedTopicButtons(ctx, mode) {
  const topics = storage.listAllTopics();
  if (topics.length === 0) {
    await ctx.reply("No topics configured yet.\n\nTap ➕ Add Topic to get started.", MAIN_MENU);
    return;
  }

  if (mode === "list") {
    const buttons = topics.map((t) => [
      Markup.button.callback(
        `📌 ${topicButtonLabel(t.chatTitle || "Group", t.name)}`,
        `view:${t.chatId}:${t.threadId}`
      ),
    ]);
    await ctx.reply(`📋 Monitoring ${topics.length} topic(s):`, Markup.inlineKeyboard(buttons));
    return;
  }

  const prefix = mode === "edit" ? "pick_edit" : "remove";
  const icon = mode === "edit" ? "✏️" : "❌";

  const buttons = topics.map((t) => [
    Markup.button.callback(
      `${icon} ${topicButtonLabel(t.chatTitle || "Group", t.name)}`,
      `${prefix}:${t.chatId}:${t.threadId}`
    ),
  ]);

  const title = mode === "edit" ? "Select a topic to edit:" : "Select a topic to remove:";
  await ctx.reply(title, Markup.inlineKeyboard(buttons));
}

async function notifyConnectionUpdate(telegram, userId, chat, member) {
  const info = chatRegistry.upsertFromMember(chat, member);
  if (!info) return;

  const name = info.title;
  const botUsername = await getBotUsername(telegram);
  const openBotUrl = getBotDmUrl(botUsername, "ready");

  if (isAdminReady(info)) {
    await telegram.sendMessage(
      userId,
      `✅ Bot is now admin in "${name}"!\n\n` +
        "Delete messages permission OK.\n\n" +
        "Tap the button below to continue setup in this chat.",
      Markup.inlineKeyboard([
        [Markup.button.url("🤖 Continue Setup", openBotUrl)],
        [Markup.button.callback("➕ Add Topic Now", "start_add_topic")],
      ])
    );
    return;
  }

  const openUrl = getGroupOpenUrl(info.username);
  const buttons = [
    [Markup.button.url("🤖 Back to Bot", openBotUrl)],
    [Markup.button.url("➕ Re-add as Admin", getAddToGroupUrl(botUsername))],
  ];

  if (openUrl) {
    buttons.splice(1, 0, [Markup.button.url(`⚙️ Open ${name}`, openUrl)]);
  }

  let text;
  if (info.status === "member") {
    text =
      `⚠️ Bot was added to "${name}" but is NOT admin yet.\n\n` +
      "Make it admin with Delete messages enabled, then come back here.\n\n" +
      "Tap 🤖 Back to Bot when done.";
  } else {
    text =
      `⚠️ Bot is admin in "${name}" but missing Delete messages permission.\n\n` +
      "Fix permissions in group settings, then tap Back to Bot.";
  }

  await telegram.sendMessage(userId, text, Markup.inlineKeyboard(buttons));
}

export function registerSetupHandlers(bot) {
  bot.command(["start", "menu"], async (ctx) => {
    if (!(await guardPrivateAdmin(ctx))) return;
    clearSession(ctx.from.id);

    if (ctx.startPayload === "ready") {
      await ctx.reply(
        "✅ Welcome back! The bot is connected.\n\nLet's add topics to restrict.",
        MAIN_MENU
      );
      await startAddTopicFlow(ctx);
      return;
    }

    await showMainMenu(ctx);
  });

  bot.command("help", async (ctx, next) => {
    if (ctx.chat.type !== "private") return next();
    if (!(await guardPrivateAdmin(ctx))) return;
    await ctx.reply(GUIDE_TEXT, { parse_mode: "MarkdownV2", ...MAIN_MENU });
  });

  bot.hears("🔗 Add to Group", async (ctx) => {
    if (!(await guardPrivateAdmin(ctx))) return;
    await sendGroupsStatus(ctx);
  });

  bot.hears("ℹ️ Setup Guide", async (ctx) => {
    if (!(await guardPrivateAdmin(ctx))) return;
    await ctx.reply(GUIDE_TEXT, { parse_mode: "MarkdownV2", ...MAIN_MENU });
  });

  bot.hears("➕ Add Topic", async (ctx) => {
    if (!(await guardPrivateAdmin(ctx))) return;
    clearSession(ctx.from.id);

    if (readyGroups().length === 0) {
      const keyboard = await buildAddGroupKeyboard(ctx.telegram);
      await ctx.reply("⚠️ No ready groups. Add the bot as admin first.", keyboard);
      return;
    }

    await startAddTopicFlow(ctx);
  });

  bot.hears("📋 My Topics", async (ctx) => {
    if (!(await guardPrivateAdmin(ctx))) return;
    await sendRestrictedTopicButtons(ctx, "list");
  });

  bot.hears("✏️ Edit Purpose", async (ctx) => {
    if (!(await guardPrivateAdmin(ctx))) return;
    clearSession(ctx.from.id);
    await sendRestrictedTopicButtons(ctx, "edit");
  });

  bot.hears("❌ Remove Topic", async (ctx) => {
    if (!(await guardPrivateAdmin(ctx))) return;
    clearSession(ctx.from.id);
    await sendRestrictedTopicButtons(ctx, "remove");
  });

  bot.action("start_add_topic", async (ctx) => {
    if (!(await guardCallbackAdmin(ctx))) return;
    await ctx.answerCbQuery();
    clearSession(ctx.from.id);
    await startAddTopicFlow(ctx);
  });

  bot.action("cancel_add", async (ctx) => {
    if (!(await guardCallbackAdmin(ctx))) return;
    await ctx.answerCbQuery();
    clearSession(ctx.from.id);
    await ctx.editMessageText("Cancelled.");
    await ctx.reply("Back to menu:", MAIN_MENU);
  });

  bot.action("add_another_topic", async (ctx) => {
    if (!(await guardCallbackAdmin(ctx))) return;
    await ctx.answerCbQuery();
    await startAddTopicFlow(ctx);
  });

  bot.action("skip_purpose", async (ctx) => {
    if (!(await guardCallbackAdmin(ctx))) return;
    const session = getSession(ctx.from.id);
    const pending = session?.pending || [
      { chatId: session?.chatId, threadId: session?.threadId, link: session?.link },
    ];
    if (!session || session.step !== "add_purpose" || !pending[0]?.chatId) {
      await ctx.answerCbQuery("Nothing to add");
      return;
    }
    await ctx.answerCbQuery();
    try {
      await completeAddTopics(ctx, pending, DEFAULT_PURPOSE);
    } catch (err) {
      await ctx.reply(`❌ ${err.message}`, MAIN_MENU);
      clearSession(ctx.from.id);
    }
  });

  bot.action("check_groups", async (ctx) => {
    if (!(await guardCallbackAdmin(ctx))) return;
    await ctx.answerCbQuery("Checking...");
    await sendGroupsStatus(ctx, { edit: true });
  });

  bot.action(/^pick_edit:(.+):(.+)$/, async (ctx) => {
    if (!(await guardCallbackAdmin(ctx))) return;
    await ctx.answerCbQuery();
    const chatId = Number(ctx.match[1]);
    const threadId = Number(ctx.match[2]);
    const topic = storage.getTopic(chatId, threadId);
    setSession(ctx.from.id, { step: "edit_purpose", chatId, threadId });
    await ctx.editMessageText(
      `Editing: ${topic?.name || "Topic"}\n\nSend the new purpose:`
    );
  });

  bot.action(/^remove:(.+):(.+)$/, async (ctx) => {
    if (!(await guardCallbackAdmin(ctx))) return;
    const chatId = Number(ctx.match[1]);
    const threadId = Number(ctx.match[2]);
    const topic = storage.getTopic(chatId, threadId);
    storage.removeTopic(chatId, threadId);
    await ctx.answerCbQuery("Removed");
    await ctx.editMessageText(`✅ Removed "${topic?.name || "topic"}" from monitoring.`);
    await ctx.reply("Back to menu:", MAIN_MENU);
  });

  bot.action(/^view:(.+):(.+)$/, async (ctx) => {
    if (!(await guardCallbackAdmin(ctx))) return;
    const chatId = Number(ctx.match[1]);
    const threadId = Number(ctx.match[2]);
    const topic = storage.getTopic(chatId, threadId);
    if (!topic) {
      await ctx.answerCbQuery("Topic not found");
      return;
    }
    await ctx.answerCbQuery();
    const lines = [
      `📌 ${topic.name}`,
      `Group: ${topic.chatTitle || chatId}`,
      "",
      "Purpose:",
      topic.purpose,
    ];
    if (topic.link) lines.push("", `Link: ${topic.link}`);
    await ctx.reply(lines.join("\n"), MAIN_MENU);
  });

  bot.on("my_chat_member", async (ctx) => {
    const { new_chat_member: member, chat, from } = ctx.myChatMember;
    chatRegistry.upsertFromMember(chat, member);

    const chatType = chat.type;
    if (
      (chatType === "group" || chatType === "supergroup" || chatType === "channel") &&
      member.status !== "left" &&
      member.status !== "kicked"
    ) {
      try {
        await registerGroupCommandsForChat(ctx.telegram, chat.id);
        await seedChatUsers(ctx.telegram, chat.id);
      } catch (err) {
        console.warn(`Failed to register group commands for ${chat.id}:`, err.message);
      }
    }

    if (from?.id) {
      try {
        await notifyConnectionUpdate(ctx.telegram, from.id, chat, member);
      } catch (err) {
        console.error(`Failed to notify user ${from.id}:`, err.message);
      }
    }
  });

  bot.on("message", async (ctx, next) => {
    if (ctx.chat.type !== "private" || !(await canUseBot(ctx.telegram, ctx.from?.id))) {
      return next();
    }

    const session = getSession(ctx.from.id);

    if (session?.step === "add_forward" || (!session && ctx.message.forward_from_chat)) {
      const forwarded = extractForwardedTopic(ctx.message);
      if (forwarded) {
        if (storage.isRestricted(forwarded.chatId, forwarded.threadId)) {
          await ctx.reply("That topic is already being monitored.", MAIN_MENU);
          clearSession(ctx.from.id);
          return;
        }

        topicDiscovery.register(
          forwarded.chatId,
          forwarded.threadId,
          `Topic #${forwarded.threadId}`,
          forwarded.chatTitle
        );
        setSession(ctx.from.id, {
          step: "add_purpose",
          pending: [
            {
              chatId: forwarded.chatId,
              threadId: forwarded.threadId,
              link: null,
            },
          ],
        });
        await ctx.reply(
          "Topic detected from forward.\n\n" +
            "Send a custom reason (optional), or tap Skip:",
          purposePromptKeyboard()
        );
        return;
      }
      if (session?.step === "add_forward") {
        await ctx.reply("Could not detect the topic. Forward a message directly from inside the topic.");
        return;
      }
    }

    if (!ctx.message.text) return next();
    if (ctx.message.text.startsWith("/")) return next();
    if (ctx.message.text.startsWith("🔗") || ctx.message.text.startsWith("➕") ||
        ctx.message.text.startsWith("📋") || ctx.message.text.startsWith("✏️") ||
        ctx.message.text.startsWith("❌") || ctx.message.text.startsWith("ℹ️")) {
      return next();
    }

    if (!session) return next();

    const text = ctx.message.text.trim();

    if (session.step === "add_link") {
      const urls = extractTopicUrls(text);
      if (urls.length === 0) {
        await ctx.reply(
          "Invalid link format.\n\nExample:\nhttps://t.me/pledgefinance/4"
        );
        return;
      }

      const { pending, errors, skipped } = await resolvePendingTopics(ctx.telegram, urls);

      if (pending.length === 0) {
        const lines = ["No new topics to add."];
        if (skipped.length) lines.push("", "Already monitored:", ...skipped);
        if (errors.length) lines.push("", "Errors:", ...errors);
        await ctx.reply(lines.join("\n"));
        return;
      }

      setSession(ctx.from.id, { step: "add_purpose", pending });

      const preview = pending
        .map((t) => `• ${t.link || `${t.chatId}/${t.threadId}`}`)
        .join("\n");

      let reply =
        `${pending.length} topic(s) ready.\n\n${preview}\n\n` +
        "Send a custom reason (optional), or tap Skip:";

      if (skipped.length) {
        reply += `\n\n(Skipped ${skipped.length} already monitored)`;
      }
      if (errors.length) {
        reply += `\n\n⚠️ Some links failed:\n${errors.join("\n")}`;
      }

      await ctx.reply(reply, purposePromptKeyboard());
      return;
    }

    if (session.step === "add_purpose") {
      const pending = session.pending || [
        { chatId: session.chatId, threadId: session.threadId, link: session.link },
      ];

      try {
        await completeAddTopics(ctx, pending, text);
      } catch (err) {
        await ctx.reply(`❌ ${err.message}`, MAIN_MENU);
        clearSession(ctx.from.id);
      }
      return;
    }

    if (session.step === "edit_purpose") {
      try {
        const result = await restrictByTopicId(
          ctx.telegram,
          session.chatId,
          session.threadId,
          text
        );
        clearSession(ctx.from.id);
        await ctx.reply(`✅ Purpose updated for ${result.name}!\n\n${text}`, MAIN_MENU);
      } catch (err) {
        await ctx.reply(`❌ ${err.message}`, MAIN_MENU);
        clearSession(ctx.from.id);
      }
      return;
    }

    return next();
  });
}
