import { DurableObject } from "cloudflare:workers";
import { SESSION_TTL_SECONDS } from "../core/constants";

export interface SessionRecord {
  /** sha256 of the raw cookie token — never the token itself. */
  tokenHash: string;
  userId: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  userAgent: string;
}

const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
/** Persist a touch at most this often, so a busy session is not a write per request. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const STORAGE_KEY = "session";

/**
 * One instance per session (DO id derived from the hashed token), so reads are
 * strongly consistent and revocation is a single delete.
 */
export class SessionDO extends DurableObject<Env> {
  async create(record: SessionRecord): Promise<void> {
    await this.ctx.storage.put(STORAGE_KEY, record);
  }

  /** Returns the record when valid; deletes it and returns null once expired. */
  async read(now: number): Promise<SessionRecord | null> {
    const record = await this.ctx.storage.get<SessionRecord>(STORAGE_KEY);
    if (!record) return null;

    // Records written under the old 30-day policy carry a longer window: clamp
    // to the current TTL so they obey it immediately, without a forced logout.
    const expiresAt = Math.min(record.expiresAt, record.lastSeenAt + SESSION_TTL_MS);
    if (expiresAt <= now) {
      await this.ctx.storage.delete(STORAGE_KEY);
      return null;
    }

    if (now - record.lastSeenAt >= TOUCH_INTERVAL_MS) {
      const touched: SessionRecord = {
        ...record,
        lastSeenAt: now,
        expiresAt: now + SESSION_TTL_MS,
      };
      await this.ctx.storage.put(STORAGE_KEY, touched);
      return touched;
    }

    return { ...record, expiresAt };
  }

  async revoke(): Promise<void> {
    await this.ctx.storage.delete(STORAGE_KEY);
  }
}
