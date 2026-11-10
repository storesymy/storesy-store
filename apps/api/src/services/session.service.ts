import { SESSION_TTL_SECONDS } from "../core/constants";
import type { SessionDO, SessionRecord } from "../durable-objects/session.do";

const encoder = new TextEncoder();

/** Session tokens are 256-bit random values; only their hash is ever persisted. */
function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sessionsStub(env: Env, tokenHash: string): DurableObjectStub<SessionDO> {
  return env.SESSIONS.get(env.SESSIONS.idFromName(tokenHash));
}

export async function createSession(
  env: Env,
  userId: string,
  userAgent: string,
): Promise<string> {
  const token = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await sessionsStub(env, tokenHash).create({
    tokenHash,
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + SESSION_TTL_SECONDS * 1000,
    userAgent: userAgent.slice(0, 200),
  });
  return token;
}

export async function readSession(env: Env, token: string): Promise<SessionRecord | null> {
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  return sessionsStub(env, tokenHash).read(Date.now());
}

export async function revokeSession(env: Env, token: string): Promise<void> {
  if (!token) return;
  const tokenHash = await sha256Hex(token);
  await sessionsStub(env, tokenHash).revoke();
}
