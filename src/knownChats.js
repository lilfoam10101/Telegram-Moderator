import { KNOWN_CHAT_IDS } from "./config.js";
import { chatRegistry } from "./chatRegistry.js";
import { storage } from "./storage.js";
import { filterStorage } from "./filterStorage.js";
import { welcomeStorage } from "./welcomeStorage.js";
import { userRegistry } from "./userRegistry.js";
import { moderatedStore } from "./moderatedStore.js";

function addChatKeys(ids, record) {
  for (const key of Object.keys(record || {})) {
    const chatId = Number(key);
    if (Number.isFinite(chatId) && chatId !== 0) ids.add(chatId);
  }
}

export function collectKnownChatIds() {
  const ids = new Set(KNOWN_CHAT_IDS);

  for (const chat of chatRegistry.list()) {
    ids.add(Number(chat.chatId));
  }

  for (const topic of storage.listAllTopics()) {
    ids.add(Number(topic.chatId));
  }

  addChatKeys(ids, filterStorage.data);
  addChatKeys(ids, welcomeStorage.data);
  addChatKeys(ids, userRegistry.data);
  addChatKeys(ids, moderatedStore.data);

  return [...ids];
}
