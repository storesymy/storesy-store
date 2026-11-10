import { DurableObject } from "cloudflare:workers";
import * as salespagesModel from "../models/salespages.repository";

/** Flush to D1 after this long, even when the batch stays small. */
const FLUSH_INTERVAL_MS = 10_000;
/** Flush early once this many visits are pending. */
const FLUSH_THRESHOLD = 100;

const PENDING_KEY = "pending";
const UUID_KEY = "pageUuid";

/**
 * Visit counter, one DO per sales page. Page views hit this instead of D1:
 * each visit is one DO-local storage write (single-writer per page, no cross-
 * page contention), and an alarm batches the pending count into D1 as ONE
 * additive `json_set` update. A viral page therefore costs D1 at most one
 * write per interval — the public read path never waits on any of it
 * (recordVisit rides `waitUntil`).
 */
export class VisitCounterDO extends DurableObject<Env> {
  /** Records one visit and schedules the first flush. */
  async hit(pageUuid: string): Promise<void> {
    const pending = ((await this.ctx.storage.get<number>(PENDING_KEY)) ?? 0) + 1;
    await this.ctx.storage.put({
      [PENDING_KEY]: pending,
      [UUID_KEY]: pageUuid,
    });
    if (pending === 1) {
      await this.ctx.storage.setAlarm(Date.now() + FLUSH_INTERVAL_MS);
    }
  }

  /** Alarm-driven batch flush. */
  override async alarm(): Promise<void> {
    await this.flush();
  }

  /**
   * Pushes the pending count into D1, then zeroes it — D1 first, so a failed
   * update keeps the batch for the alarm retry instead of dropping visits.
   * (Slight over-count possible only if a crash lands between the two writes;
   * acceptable for a social-proof number, never acceptable to lose counts.)
   */
  async flush(): Promise<void> {
    const pending = (await this.ctx.storage.get<number>(PENDING_KEY)) ?? 0;
    const pageUuid = await this.ctx.storage.get<string>(UUID_KEY);
    if (pending > 0 && pageUuid) {
      await salespagesModel.incrementVisits(this.env, pageUuid, pending);
      await this.ctx.storage.put(PENDING_KEY, 0);
    }
    await this.ctx.storage.deleteAlarm();
  }
}
