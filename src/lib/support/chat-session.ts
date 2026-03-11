import { cacheGet, cacheSet, cacheDelete } from '@/lib/redis';
import type { ChatSession, ChatMessage } from './types';

const SESSION_TTL = 60 * 60 * 24; // 24 hours
const MAX_CONTEXT_MESSAGES = 20;

function sessionKey(userId: string, sessionId: string): string {
  return `support-chat:${userId}:${sessionId}`;
}

export async function getSession(userId: string, sessionId: string): Promise<ChatSession | null> {
  return cacheGet<ChatSession>(sessionKey(userId, sessionId));
}

export async function getOrCreateSession(
  userId: string,
  sessionId: string,
  clerkOrgId: string,
): Promise<ChatSession> {
  const existing = await getSession(userId, sessionId);
  if (existing) return existing;

  const session: ChatSession = {
    id: sessionId,
    userId,
    clerkOrgId,
    messages: [],
    escalated: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await cacheSet(sessionKey(userId, sessionId), session, SESSION_TTL);
  return session;
}

export async function appendMessage(
  userId: string,
  sessionId: string,
  message: ChatMessage,
): Promise<ChatSession | null> {
  const session = await getSession(userId, sessionId);
  if (!session) return null;

  session.messages.push(message);
  session.updatedAt = Date.now();

  await cacheSet(sessionKey(userId, sessionId), session, SESSION_TTL);
  return session;
}

export async function clearSession(userId: string, sessionId: string): Promise<boolean> {
  return cacheDelete(sessionKey(userId, sessionId));
}

export async function markEscalated(userId: string, sessionId: string): Promise<ChatSession | null> {
  const session = await getSession(userId, sessionId);
  if (!session) return null;

  session.escalated = true;
  session.updatedAt = Date.now();
  await cacheSet(sessionKey(userId, sessionId), session, SESSION_TTL);
  return session;
}

/** Return the most recent messages for the LLM context window. */
export function getContextMessages(session: ChatSession): ChatMessage[] {
  if (session.messages.length <= MAX_CONTEXT_MESSAGES) {
    return session.messages;
  }
  return session.messages.slice(-MAX_CONTEXT_MESSAGES);
}
