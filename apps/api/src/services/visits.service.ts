import type { VisitCounterDO } from "../durable-objects/visit-counter.do";

function visitStub(env: Env, pageUuid: string): DurableObjectStub<VisitCounterDO> {
  return env.VISIT_COUNTER.get(env.VISIT_COUNTER.idFromName(`visit:${pageUuid}`));
}

/**
 * Records one page view. The caller fires this inside `ctx.waitUntil`: the
 * RPC lands on the page's counter DO (batched, flushed to D1 on an alarm),
 * and the HTTP response never waits for it.
 */
export async function recordVisit(env: Env, pageUuid: string): Promise<void> {
  await visitStub(env, pageUuid).hit(pageUuid);
}
