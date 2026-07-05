// lib/sessions.js — INDx Agent
// Gestión de sesiones en memoria por número de teléfono

const sessions   = new Map();
const SESSION_TTL = 4 * 60 * 60 * 1000; // 4 horas
const MAX_TURNS   = 10;

export function getSession(phone) {
  const session = sessions.get(phone);
  if (!session) return { messages: [], meta: {} };
  if (Date.now() - session.lastActivity > SESSION_TTL) {
    sessions.delete(phone);
    return { messages: [], meta: {} };
  }
  return session;
}

export function saveSession(phone, messages, meta = {}) {
  const existing = sessions.get(phone) || { meta: {} };
  sessions.set(phone, {
    messages: trimHistory(messages),
    meta: { ...existing.meta, ...meta },
    lastActivity: Date.now()
  });
}

export function clearSession(phone) {
  sessions.delete(phone);
}

export function getSessionStats() {
  return {
    activeSessions: sessions.size,
    phones: [...sessions.keys()].map(p => p.slice(-4))
  };
}

function trimHistory(messages) {
  if (messages.length <= MAX_TURNS * 2) return messages;
  const first  = messages.slice(0, 2);
  const recent = messages.slice(-(MAX_TURNS * 2 - 2));
  return [...first, ...recent];
}

setInterval(() => {
  const now = Date.now();
  for (const [phone, session] of sessions.entries()) {
    if (now - session.lastActivity > SESSION_TTL) sessions.delete(phone);
  }
}, 30 * 60 * 1000);
