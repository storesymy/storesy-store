import { asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { IntegrationRow, NewIntegrationRow } from "./schema";
import { integrations } from "./schema";

function db(env: Env) {
  return drizzle(env.DB);
}

/**
 * Integrations, oldest first — instances on a card read in the order they
 * were created (1, 2, …). Like products and orders, rows are not
 * account-scoped: one install serves one catalogue, and access is gated by
 * role at the controller instead.
 */
export async function listIntegrations(env: Env): Promise<IntegrationRow[]> {
  return db(env).select().from(integrations).orderBy(asc(integrations.id)).all();
}

/**
 * The newest CONNECTED instance of one provider. Shipping quotes use the most
 * recently added live MyParcel Asia account; older rows stay for history.
 */
export async function findLatestConnectedIntegration(
  env: Env,
  provider: string,
): Promise<IntegrationRow | null> {
  const rows = await db(env)
    .select()
    .from(integrations)
    .where(eq(integrations.provider, provider))
    .orderBy(desc(integrations.id))
    .all();
  return rows.find((row) => row.data.connected) ?? null;
}

/**
 * First connected email sender — used for account invitations. Gmail wins
 * over Cloudflare: Cloudflare can be present for another purpose without a
 * verified sender address, while a connected Gmail row always carries the
 * account address it sends from.
 */
export async function findFirstEmailIntegration(env: Env): Promise<IntegrationRow | null> {
  const rows = await db(env).select().from(integrations).orderBy(asc(integrations.id)).all();
  return (
    rows.find((row) => row.data.connected && row.provider === "gmail") ??
    rows.find((row) => row.data.connected && row.provider === "cloudflare") ??
    null
  );
}

export async function findIntegrationById(env: Env, id: number): Promise<IntegrationRow | null> {
  const rows = await db(env)
    .select()
    .from(integrations)
    .where(eq(integrations.id, id))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

export async function findIntegration(env: Env, uuid: string): Promise<IntegrationRow | null> {
  const rows = await db(env)
    .select()
    .from(integrations)
    .where(eq(integrations.uuid, uuid))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

export async function insertIntegration(
  env: Env,
  values: NewIntegrationRow,
): Promise<IntegrationRow> {
  const created = await db(env).insert(integrations).values(values).returning().all();
  return created[0] as IntegrationRow;
}

export async function updateIntegration(
  env: Env,
  uuid: string,
  values: Partial<NewIntegrationRow>,
): Promise<IntegrationRow | null> {
  const updated = await db(env)
    .update(integrations)
    .set(values)
    .where(eq(integrations.uuid, uuid))
    .returning()
    .all();
  return updated[0] ?? null;
}

export async function deleteIntegration(env: Env, uuid: string): Promise<boolean> {
  const removed = await db(env)
    .delete(integrations)
    .where(eq(integrations.uuid, uuid))
    .returning({ id: integrations.id })
    .all();
  return removed.length > 0;
}
