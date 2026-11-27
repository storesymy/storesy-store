import { ADMIN_ROLES, MENU_KEYS } from "@storesy/shared";
import { asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { NewUserRow, UserRow } from "./schema";
import { users } from "./schema";

function db(env: Env) {
  return drizzle(env.DB);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(env: Env, email: string): Promise<UserRow | null> {
  const rows = await db(env)
    .select()
    .from(users)
    .where(eq(users.email, normalizeEmail(email)))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

/**
 * Look up by the public id — the prefixed UUIDv7 in `users.uuid`. Sessions
 * store and carry the public id, never the internal rowid.
 */
export async function findUserById(env: Env, id: string): Promise<UserRow | null> {
  const rows = await db(env).select().from(users).where(eq(users.uuid, id)).limit(1).all();
  return rows[0] ?? null;
}

/** Case-insensitive name/email search, newest first, for /users. */
export async function listUsersPage(
  env: Env,
  params: { search?: string; page: number; perPage: number },
): Promise<UserRow[]> {
  const term = (params.search ?? "").trim().toLowerCase();
  const where = term
    ? or(
        sql`lower(${users.name}) like ${`%${term}%`}`,
        sql`lower(${users.email}) like ${`%${term}%`}`,
      )
    : undefined;
  const base = db(env).select().from(users);
  return (where ? base.where(where) : base)
    .orderBy(desc(users.id))
    .limit(params.perPage)
    .offset((params.page - 1) * params.perPage)
    .all();
}

export async function countUsersMatching(env: Env, search?: string): Promise<number> {
  const term = (search ?? "").trim().toLowerCase();
  const where = term
    ? or(
        sql`lower(${users.name}) like ${`%${term}%`}`,
        sql`lower(${users.email}) like ${`%${term}%`}`,
      )
    : undefined;
  const base = db(env).select({ count: sql<number>`count(*)` }).from(users);
  const rows = await (where ? base.where(where) : base).all();
  return rows[0]?.count ?? 0;
}

export async function findUserByInviteTokenHash(
  env: Env,
  tokenHash: string,
): Promise<UserRow | null> {
  const rows = await db(env)
    .select()
    .from(users)
    .where(eq(users.inviteTokenHash, tokenHash))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

export async function updateUser(
  env: Env,
  id: number,
  values: Partial<NewUserRow>,
): Promise<UserRow | null> {
  const updated = await db(env).update(users).set(values).where(eq(users.id, id)).returning().all();
  return updated[0] ?? null;
}

export async function deleteUser(env: Env, id: number): Promise<boolean> {
  const removed = await db(env)
    .delete(users)
    .where(eq(users.id, id))
    .returning({ id: users.id })
    .all();
  return removed.length > 0;
}

/**
 * Domains that can never receive mail (RFC 2606 / RFC 6761 reserved names).
 * Test sign-ups and seed accounts use these; mailing one guarantees a bounce,
 * so notifications skip them.
 */
const RESERVED_MAIL_DOMAINS = new Set(["example.com", "example.net", "example.org"]);
const RESERVED_MAIL_TLDS = [".test", ".example", ".invalid", ".localhost"];

/** True for an address on a reserved/demo domain (never delivers). */
export function isUndeliverableDemoEmail(email: string): boolean {
  const domain = (email.split("@")[1] ?? "").trim().toLowerCase();
  if (domain === "") return true;
  if (RESERVED_MAIL_DOMAINS.has(domain)) return true;
  return RESERVED_MAIL_TLDS.some((tld) => domain.endsWith(tld));
}

/**
 * The store's primary admin: the earliest account holding an admin role whose
 * address can actually receive mail. Checkout notifications go here — the
 * person who set the store up — rather than an early test account on
 * `example.com` that would bounce. The caller falls back to the store's own
 * sending address when no deliverable admin exists.
 */
export async function firstAdminEmail(env: Env): Promise<string | null> {
  const rows = await db(env)
    .select({ email: users.email })
    .from(users)
    .where(inArray(users.role, [...ADMIN_ROLES]))
    .orderBy(asc(users.id))
    .all();
  return rows.find((row) => !isUndeliverableDemoEmail(row.email))?.email ?? null;
}

/** How many accounts exist — the self-signup policy is "first one only". */
export async function countUsers(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
  return row?.count ?? 0;
}

/**
 * The only self-signup: insert the very first user as `owner`, atomically.
 *
 * `WHERE NOT EXISTS (SELECT 1 FROM users)` makes the first-user check part of
 * the write itself, so two concurrent signups cannot both succeed. Returns
 * null when the slot is already taken.
 */
export async function insertFirstUser(env: Env, row: NewUserRow): Promise<UserRow | null> {
  const result = await env.DB.prepare(
    `INSERT INTO users (uuid, email, name, password_hash, role, status, data)
     SELECT ?1, ?2, ?3, ?4, 'owner', 'active', ?5
     WHERE NOT EXISTS (SELECT 1 FROM users)`,
  )
    .bind(
      row.uuid,
      row.email,
      row.name,
      row.passwordHash,
      JSON.stringify({ menuAccess: [...MENU_KEYS] }),
    )
    .run();
  if ((result.meta.changes ?? 0) !== 1) return null;
  return findUserByEmail(env, row.email);
}

export async function insertUser(env: Env, row: NewUserRow): Promise<UserRow> {
  const inserted = await db(env).insert(users).values(row).returning().all();
  const created = inserted[0];
  if (!created) throw new Error("User insert returned no row");
  return created;
}

export function isUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /UNIQUE constraint failed/i.test(error.message);
}
