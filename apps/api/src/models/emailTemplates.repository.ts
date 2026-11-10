import type { EmailTemplateDefinition } from "@storesy/shared";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import type { EmailTemplateData, EmailTemplateRow, NewEmailTemplateRow } from "./schema";
import { emailTemplates } from "./schema";
import { klNow } from "../services/time";
import { entityUuid } from "../services/uuid";

/**
 * Email templates — one row per automated message. Rows are install-wide and
 * (unlike integrations) readable by any signed-in account: the copy owners
 * write belongs with the storefront, not with credentials.
 */

function db(env: Env) {
  return drizzle(env.DB);
}

export async function listTemplates(env: Env): Promise<EmailTemplateRow[]> {
  return db(env).select().from(emailTemplates).orderBy(asc(emailTemplates.id)).all();
}

export async function findTemplateByKey(env: Env, key: string): Promise<EmailTemplateRow | null> {
  const rows = await db(env)
    .select()
    .from(emailTemplates)
    .where(eq(emailTemplates.key, key))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

export async function findTemplateByUuid(env: Env, uuid: string): Promise<EmailTemplateRow | null> {
  const rows = await db(env)
    .select()
    .from(emailTemplates)
    .where(eq(emailTemplates.uuid, uuid))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

/**
 * The built-in row, created on first use. Two concurrent readers can both see
 * "missing" and insert; the unique key lets exactly one win, and the loser
 * re-reads. Never overwrites an edited template.
 */
export async function ensureTemplate(
  env: Env,
  definition: EmailTemplateDefinition,
): Promise<EmailTemplateRow> {
  const existing = await findTemplateByKey(env, definition.key);
  if (existing) return existing;

  const now = klNow();
  const values: NewEmailTemplateRow = {
    uuid: entityUuid("tpl"),
    key: definition.key,
    name: definition.name,
    data: {
      description: definition.description,
      subject: definition.subject,
      body: definition.body,
      createdAt: now,
      updatedAt: now,
    },
  };

  try {
    const created = await db(env).insert(emailTemplates).values(values).returning().all();
    return created[0] as EmailTemplateRow;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await findTemplateByKey(env, definition.key);
    if (!raced) throw error;
    return raced;
  }
}

export async function updateTemplate(
  env: Env,
  uuid: string,
  patch: Pick<EmailTemplateData, "subject" | "body">,
): Promise<EmailTemplateRow | null> {
  const current = await findTemplateByUuid(env, uuid);
  if (!current) return null;
  const updated = await db(env)
    .update(emailTemplates)
    .set({
      data: { ...current.data, subject: patch.subject, body: patch.body, updatedAt: klNow() },
    })
    .where(eq(emailTemplates.uuid, uuid))
    .returning()
    .all();
  return updated[0] ?? null;
}
