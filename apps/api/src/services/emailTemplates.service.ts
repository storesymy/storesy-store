import {
  DEFAULT_EMAIL_TEMPLATES,
  EMAIL_TEMPLATE_PLACEHOLDERS,
  THANK_YOU_TEMPLATE_KEY,
  defaultEmailTemplate,
} from "@storesy/shared";
import type { EmailTemplate, UpdateEmailTemplateInput } from "@storesy/shared";
import { notFound } from "../core/errors";
import type { EmailTemplateRow } from "../models/schema";
import * as repo from "../models/emailTemplates.repository";

/**
 * The /templates read + write path. Built-in templates are seeded on read, so
 * the gallery always has its cards even on a fresh install.
 */

function placeholdersFor(key: string): EmailTemplate["placeholders"] {
  return key === THANK_YOU_TEMPLATE_KEY ? EMAIL_TEMPLATE_PLACEHOLDERS : [];
}

export function toDto(row: EmailTemplateRow): EmailTemplate {
  return {
    id: row.uuid,
    key: row.key,
    name: row.name,
    description: row.data.description,
    subject: row.data.subject,
    body: row.data.body,
    placeholders: placeholdersFor(row.key),
    updatedAt: row.data.updatedAt,
  };
}

/** Every template, oldest first; missing built-ins are created first. */
export async function list(env: Env): Promise<EmailTemplate[]> {
  for (const definition of DEFAULT_EMAIL_TEMPLATES) {
    await repo.ensureTemplate(env, definition);
  }
  const rows = await repo.listTemplates(env);
  return rows.map(toDto);
}

export async function update(
  env: Env,
  uuid: string,
  input: UpdateEmailTemplateInput,
): Promise<EmailTemplate> {
  const row = await repo.updateTemplate(env, uuid, { subject: input.subject, body: input.body });
  if (!row) throw notFound("template_not_found", "No email template with that id");
  return toDto(row);
}

/**
 * The text a send site should render. Falls back to the built-in definition
 * when the row is missing; callers still treat an unexpected database error as
 * "use the default message" rather than failing the send.
 */
export async function contentFor(
  env: Env,
  key: string,
): Promise<{ subject: string; body: string } | null> {
  const definition = defaultEmailTemplate(key);
  const row = definition ? await repo.ensureTemplate(env, definition) : await repo.findTemplateByKey(env, key);
  if (row) return { subject: row.data.subject, body: row.data.body };
  return definition ? { subject: definition.subject, body: definition.body } : null;
}
