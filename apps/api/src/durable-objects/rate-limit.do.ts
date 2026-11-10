import { DurableObject } from "cloudflare:workers";

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

const STORAGE_PREFIX = "bucket:";

/**
 * Fixed-window counter, one DO per limiter key (e.g. `login:<email>` or
 * `signup:<ip>`). Strongly consistent, so it cannot be raced like a KV counter.
 */
export class RateLimitDO extends DurableObject<Env> {
  async hit(key: string, limit: number, windowMs: number, now: number): Promise<RateLimitResult> {
    const storageKey = `${STORAGE_PREFIX}${key}`;
    const bucket = await this.ctx.storage.get<Bucket>(storageKey);

    if (!bucket || bucket.resetAt <= now) {
      await this.ctx.storage.put(storageKey, { count: 1, resetAt: now + windowMs } satisfies Bucket);
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
    }

    if (bucket.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    }

    bucket.count += 1;
    await this.ctx.storage.put(storageKey, bucket);
    return { allowed: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
  }

  async reset(key: string): Promise<void> {
    await this.ctx.storage.delete(`${STORAGE_PREFIX}${key}`);
  }
}
