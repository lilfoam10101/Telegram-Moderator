import { chatRegistry } from "./chatRegistry.js";

export async function isGroupAdmin(telegram, chatId, userId) {
  if (userId == null) return false;
  const uid = Number(userId);

  try {
    const member = await telegram.getChatMember(chatId, uid);
    return member.status === "administrator" || member.status === "creator";
  } catch (err) {
    console.warn(
      `getChatMember failed for ${uid} in ${chatId}:`,
      err.response?.description || err.message
    );

    try {
      const admins = await telegram.getChatAdministrators(chatId);
      return admins.some(
        (a) => a.user.id === uid && (a.status === "administrator" || a.status === "creator")
      );
    } catch (err2) {
      console.error(`getChatAdministrators failed for ${chatId}:`, err2.message);
      return false;
    }
  }
}

export async function isAdminInAnyChat(telegram, userId) {
  if (userId == null) return false;

  for (const chat of chatRegistry.list()) {
    if (await isGroupAdmin(telegram, chat.chatId, userId)) return true;
  }
  return false;
}
