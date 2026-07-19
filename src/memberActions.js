import { isGroupAdmin } from "./auth.js";
import { canManageChat, resolveActorId } from "./moderation.js";
import { userRegistry } from "./userRegistry.js";
import { moderatedStore } from "./moderatedStore.js";

const CONFIRM_DELETE_SECONDS = 5;

const MUTE_PERMISSIONS = {
  can_send_messages: false,
  can_send_audios: false,
  can_send_documents: false,
  can_send_photos: false,
  can_send_videos: false,
  can_send_video_notes: false,
  can_send_voice_notes: false,
  can_send_polls: false,
  can_send_other_messages: false,
  can_add_web_page_previews: false,
  can_change_info: false,
  can_invite_users: false,
  can_pin_messages: false,
  can_manage_topics: false,
};

const DEFAULT_MEMBER_PERMISSIONS = {
  can_send_messages: true,
  can_send_audios: true,
  can_send_documents: true,
  can_send_photos: true,
  can_send_videos: true,
  can_send_video_notes: true,
  can_send_voice_notes: true,
  can_send_polls: true,
  can_send_other_messages: true,
  can_add_web_page_previews: true,
  can_change_info: false,
  can_invite_users: true,
  can_pin_messages: false,
  can_manage_topics: false,
};

function scheduleDelete(telegram, chatId, messageId) {
  setTimeout(() => {
    telegram.deleteMessage(chatId, messageId).catch(() => {});
  }, CONFIRM_DELETE_SECONDS * 1000);
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
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}

function getCommandText(ctx) {
  return ctx.message?.text || ctx.channelPost?.text || "";
}

function getCommandEnd(msg, command) {
  for (const entity of msg?.entities || []) {
    if (entity.type === "bot_command") {
      return entity.offset + entity.length;
    }
  }
  const text = msg?.text || "";
  const match = text.match(new RegExp(`^\\/${command}(?:@[\\w_]+)?`, "i"));
  return match ? match[0].length : 0;
}

function extractUserFromEntities(msg, command) {
  const text = msg?.text || "";
  if (!text) return null;

  const afterCmd = getCommandEnd(msg, command);

  for (const entity of msg.entities || []) {
    if (entity.offset < afterCmd) continue;
    if (entity.type === "text_mention" && entity.user && !entity.user.is_bot) {
      return { user: entity.user };
    }
  }

  for (const entity of msg.entities || []) {
    if (entity.offset < afterCmd) continue;
    if (entity.type === "mention") {
      const username = text.slice(entity.offset + 1, entity.offset + entity.length);
      return { username };
    }
  }

  return null;
}

async function scanKnownIdsForUsername(ctx, username) {
  const lower = username.toLowerCase();
  const ids = new Set([
    ...userRegistry.getAllUserIds(ctx.chat.id),
    ...moderatedStore.getAllUserIds(ctx.chat.id),
  ]);

  for (const userId of ids) {
    try {
      const member = await ctx.telegram.getChatMember(ctx.chat.id, userId);
      const user = member.user;
      userRegistry.remember(ctx.chat.id, user);
      if (user.username?.toLowerCase() === lower) {
        return user;
      }
    } catch {
      // skip
    }
  }
  return null;
}

async function lookupMember(ctx, query) {
  const q = query.replace(/^@/, "").trim();
  if (!q) return null;

  const byUsername = userRegistry.getByUsername(ctx.chat.id, q);
  if (byUsername) return userRegistry.toUser(byUsername);

  const byModerated = moderatedStore.getByUsername(ctx.chat.id, q);
  if (byModerated) {
    try {
      const member = await ctx.telegram.getChatMember(ctx.chat.id, byModerated.id);
      userRegistry.remember(ctx.chat.id, member.user);
      return member.user;
    } catch {
      return userRegistry.toUser(byModerated);
    }
  }

  const byName = userRegistry.getByFirstName(ctx.chat.id, q);
  if (byName) return userRegistry.toUser(byName);

  const fuzzy = userRegistry.search(ctx.chat.id, q);
  if (fuzzy) return userRegistry.toUser(fuzzy);

  try {
    const admins = await ctx.telegram.getChatAdministrators(ctx.chat.id);
    for (const entry of admins) {
      userRegistry.remember(ctx.chat.id, entry.user);
      const u = entry.user;
      const lower = q.toLowerCase();
      if (
        u.username?.toLowerCase() === lower ||
        u.first_name?.toLowerCase() === lower ||
        u.username?.toLowerCase().includes(lower) ||
        u.first_name?.toLowerCase().includes(lower)
      ) {
        return u;
      }
    }
  } catch {
    // ignore
  }

  const scanned = await scanKnownIdsForUsername(ctx, q);
  if (scanned) return scanned;

  return null;
}

function extractAnyTextMention(msg) {
  for (const entity of msg?.entities || []) {
    if (entity.type === "text_mention" && entity.user && !entity.user.is_bot) {
      return entity.user;
    }
  }
  return null;
}

function resolveTargetFromReply(msg) {
  const reply = msg?.reply_to_message;
  if (!reply) return null;
  if (reply.sender_chat) return null;
  if (reply.from && !reply.from.is_bot) return reply.from;
  return null;
}

async function resolveTargetUser(ctx, command) {
  const msg = ctx.message;
  const text = getCommandText(ctx);

  const anyMention = extractAnyTextMention(msg);
  if (anyMention) {
    userRegistry.remember(ctx.chat.id, anyMention);
    return { target: anyMention };
  }

  const fromEntity = extractUserFromEntities(msg, command);
  if (fromEntity?.user) {
    userRegistry.remember(ctx.chat.id, fromEntity.user);
    return { target: fromEntity.user };
  }

  if (fromEntity?.username) {
    const user = await lookupMember(ctx, fromEntity.username);
    if (user) return { target: user };
  }

  const idMatch = text.match(new RegExp(`^\\/${command}(?:@[\\w_]+)?\\s*(\\d+)`, "i"));
  if (idMatch) {
    return { target: { id: Number(idMatch[1]) } };
  }

  const userMatch = text.match(new RegExp(`^\\/${command}(?:@[\\w_]+)?\\s*@(\\w{3,})`, "i"));
  if (userMatch) {
    const user = await lookupMember(ctx, userMatch[1]);
    if (user) return { target: user };
  }

  const nameMatch = text.match(new RegExp(`^\\/${command}(?:@[\\w_]+)?\\s+([^\\s@/][^\\s]*)`, "i"));
  if (nameMatch) {
    const user = await lookupMember(ctx, nameMatch[1]);
    if (user) return { target: user };
  }

  const replyTarget = resolveTargetFromReply(msg);
  if (replyTarget) {
    userRegistry.remember(ctx.chat.id, replyTarget);
    return { target: replyTarget };
  }

  if (fromEntity?.username || userMatch || nameMatch) {
    const query = fromEntity?.username || userMatch?.[1] || nameMatch?.[1];
    return {
      error:
        `@${query.replace(/^@/, "")} not found in this group. ` +
        "Use /" +
        `${command} @username from your personal admin account, or reply to their message.`,
    };
  }

  return {
    error: `Reply to the member's personal message and send /${command}.`,
  };
}

function formatModError(err, action) {
  const msg = err.response?.description || err.message || "";
  if (msg.includes("chat owner")) {
    return "Telegram does not allow muting or unmuting the group owner.";
  }
  return `Failed to ${action}: ${msg}`;
}

async function validateModeration(ctx, command, { allowAdmin = false } = {}) {
  if (!isGroupChat(ctx)) return { error: "This command only works in groups." };
  if (!(await canManageChat(ctx))) return { error: "Only group admins can use this command." };

  const resolved = await resolveTargetUser(ctx, command);
  if (resolved.error) return { error: resolved.error };

  const target = resolved.target;
  const actorId = resolveActorId(ctx);
  if (actorId && target.id === actorId) {
    return { error: "You can't use this on yourself." };
  }

  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, target.id);
    if (member.status === "creator") {
      return { error: "Telegram does not allow muting or unmuting the group owner." };
    }
    if (
      !allowAdmin &&
      (member.status === "administrator" || (await isGroupAdmin(ctx.telegram, ctx.chat.id, target.id)))
    ) {
      return { error: "Can't moderate another admin." };
    }
    return { target, member };
  } catch (err) {
    return { error: `Could not verify member: ${err.message}` };
  }
}

async function handleMute(ctx) {
  const check = await validateModeration(ctx, "mute");
  if (check.error) {
    await replyEphemeral(ctx, check.error);
    return;
  }

  if (ctx.chat.type !== "supergroup") {
    await replyEphemeral(ctx, "Mute only works in supergroups.");
    return;
  }

  const { target } = check;
  try {
    await ctx.telegram.restrictChatMember(ctx.chat.id, target.id, {
      permissions: MUTE_PERMISSIONS,
      use_independent_chat_permissions: true,
    });
    const member = await ctx.telegram.getChatMember(ctx.chat.id, target.id);
    moderatedStore.remember(ctx.chat.id, member.user);
    userRegistry.remember(ctx.chat.id, member.user);
    await replyEphemeral(ctx, `Muted ${displayName(target)}.`);
  } catch (err) {
    await replyEphemeral(ctx, formatModError(err, "mute"));
  }
}

async function handleBan(ctx) {
  const check = await validateModeration(ctx, "ban");
  if (check.error) {
    await replyEphemeral(ctx, check.error);
    return;
  }

  const { target } = check;
  try {
    await ctx.telegram.banChatMember(ctx.chat.id, target.id, {
      revoke_messages: true,
    });
    await replyEphemeral(ctx, `Banned ${displayName(target)}.`);
  } catch (err) {
    await replyEphemeral(ctx, `Failed to ban: ${err.message}`);
  }
}

async function handleKick(ctx) {
  const check = await validateModeration(ctx, "kick");
  if (check.error) {
    await replyEphemeral(ctx, check.error);
    return;
  }

  const { target } = check;
  try {
    await ctx.telegram.banChatMember(ctx.chat.id, target.id, {
      revoke_messages: true,
    });
    await ctx.telegram.unbanChatMember(ctx.chat.id, target.id);
    await replyEphemeral(ctx, `Kicked ${displayName(target)}.`);
  } catch (err) {
    await replyEphemeral(ctx, `Failed to kick: ${err.message}`);
  }
}

function displayName(user) {
  return user.first_name || user.username || String(user.id);
}

async function validateUnban(ctx) {
  if (!isGroupChat(ctx)) return { error: "This command only works in groups." };
  if (!(await canManageChat(ctx))) return { error: "Only group admins can use this command." };

  const resolved = await resolveTargetUser(ctx, "unban");
  if (resolved.error) return { error: resolved.error };

  const target = resolved.target;
  const actorId = resolveActorId(ctx);
  if (actorId && target.id === actorId) {
    return { error: "You can't use this on yourself." };
  }

  return { target };
}

async function handleUnmute(ctx) {
  const check = await validateModeration(ctx, "unmute", { allowAdmin: true });
  if (check.error) {
    await replyEphemeral(ctx, check.error);
    return;
  }

  if (ctx.chat.type !== "supergroup") {
    await replyEphemeral(ctx, "Unmute only works in supergroups.");
    return;
  }

  const { target } = check;

  try {
    await ctx.telegram.restrictChatMember(ctx.chat.id, target.id, {
      permissions: DEFAULT_MEMBER_PERMISSIONS,
      use_independent_chat_permissions: true,
    });
    const label = target.username ? `@${target.username}` : displayName(target);
    await replyEphemeral(ctx, `Unmuted ${label}.`);
  } catch (err) {
    await replyEphemeral(ctx, formatModError(err, "unmute"));
  }
}

async function handleUnban(ctx) {
  const check = await validateUnban(ctx);
  if (check.error) {
    await replyEphemeral(ctx, check.error);
    return;
  }

  const { target } = check;
  try {
    await ctx.telegram.unbanChatMember(ctx.chat.id, target.id, {
      only_if_banned: true,
    });
    await replyEphemeral(ctx, `Unbanned ${displayName(target)}.`);
  } catch (err) {
    await replyEphemeral(ctx, `Failed to unban: ${err.message}`);
  }
}

export function registerMemberActionHandlers(bot) {
  bot.command("mute", handleMute);
  bot.command("unmute", handleUnmute);
  bot.command("ban", handleBan);
  bot.command("unban", handleUnban);
  bot.command("kick", handleKick);
}
