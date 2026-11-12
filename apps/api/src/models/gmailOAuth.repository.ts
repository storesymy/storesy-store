import { asc, eq, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { GmailOAuthFlowData, GmailOAuthFlowRow, NewGmailOAuthFlowRow } from "./schema";
import { gmailOAuthFlows } from "./schema";
import { klNow } from "../services/time";

/**
 * Gmail OAuth flows — one row per sign-in attempt. The `state` is hashed
 * before it is stored; after Google answers the row carries the account email
 * and the encrypted refresh token until Save, Cancel or expiry.
 */

function db(env: Env) {
  return drizzle(env.DB);
}

export async function insertFlow(
  env: Env,
  values: NewGmailOAuthFlowRow,
): Promise<GmailOAuthFlowRow> {
  const created = await db(env).insert(gmailOAuthFlows).values(values).returning().all();
  return created[0] as GmailOAuthFlowRow;
}

export async function findByStateHash(
  env: Env,
  stateHash: string,
): Promise<GmailOAuthFlowRow | null> {
  const rows = await db(env)
    .select()
    .from(gmailOAuthFlows)
    .where(eq(gmailOAuthFlows.state_hash, stateHash))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

export async function findByUuid(env: Env, uuid: string): Promise<GmailOAuthFlowRow | null> {
  const rows = await db(env)
    .select()
    .from(gmailOAuthFlows)
    .where(eq(gmailOAuthFlows.uuid, uuid))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

/**
 * Atomically mark a started flow as exchanging — one conditional UPDATE, so a
 * replayed callback can never exchange the same code twice.
 */
export async function consumeState(env: Env, uuid: string): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE gmail_oauth_flows
     SET data = json_set(data, '$.status', 'exchanging')
     WHERE uuid = ? AND json_extract(data, '$.status') = 'started'`,
  )
    .bind(uuid)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

/** Store Google's answer (email + encrypted refresh token) and mark ready. */
export async function markReady(
  env: Env,
  uuid: string,
  email: string,
  refreshToken: string,
  scopes: string[],
): Promise<void> {
  await env.DB.prepare(
    `UPDATE gmail_oauth_flows
     SET data = json_set(
       data,
       '$.status', 'ready',
       '$.email', ?,
       '$.refreshToken', ?,
       '$.scopes', json(?)
     )
     WHERE uuid = ?`,
  )
    .bind(email, refreshToken, JSON.stringify(scopes), uuid)
    .run();
}

export async function deleteFlow(env: Env, uuid: string): Promise<void> {
  await db(env).delete(gmailOAuthFlows).where(eq(gmailOAuthFlows.uuid, uuid)).run();
}

/** Opportunistic cleanup — every start sweeps expired flows away. */
export async function deleteExpired(env: Env): Promise<void> {
  await db(env)
    .delete(gmailOAuthFlows)
    .where(lte(gmailOAuthFlows.expires_at, klNow()))
    .run();
}

/** Oldest first, for diagnostics. */
export async function listFlows(env: Env): Promise<GmailOAuthFlowRow[]> {
  return db(env).select().from(gmailOAuthFlows).orderBy(asc(gmailOAuthFlows.id)).all();
}
