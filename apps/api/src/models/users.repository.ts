import { ADMIN_ROLES } from "@storesy/shared";
import { asc, eq, inArray } from "drizzle-orm";
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
