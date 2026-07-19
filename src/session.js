const sessions = new Map();

export function getSession(userId) {
  return sessions.get(userId) || null;
}

export function setSession(userId, session) {
  sessions.set(userId, session);
}

export function clearSession(userId) {
  sessions.delete(userId);
}
