import type { RateLimitDO, RateLimitResult } from "../durable-objects/rate-limit.do";
import { tooManyRequests } from "../core/errors";

function rateLimitStub(env: Env, key: string): DurableObjectStub<RateLimitDO> {
  return env.RATE_LIMITS.get(env.RATE_LIMITS.idFromName(key));
}

export async function checkRateLimit(
  env: Env,
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  return rateLimitStub(env, key).hit(key, limit, windowMs, Date.now());
}

export async function resetRateLimit(env: Env, key: string): Promise<void> {
  await rateLimitStub(env, key).reset(key);
}

/** Throws 429 (with Retry-After) when the window is exhausted. */
export async function enforceRateLimit(
  env: Env,
  key: string,
  limit: number,
  windowMs: number,
  message = "Too many attempts. Please try again later.",
): Promise<void> {
  const result = await checkRateLimit(env, key, limit, windowMs);
  if (!result.allowed) {
    throw tooManyRequests(message, result.retryAfterSeconds);
  }
}
