import {
  INTEGRATION_PROVIDERS,
  DEFAULT_EMAIL_SUBJECT,
  randomEmailBody,
  createIntegrationSchema,
  providerOf,
  updateIntegrationSchema,
} from "@storesy/shared";
import type { IntegrationRecord } from "@storesy/shared";
import type { z } from "zod";
import { AppError, badRequest, notFound, validationFailed } from "../core/errors";
import type { IntegrationData, IntegrationRow } from "../models/schema";
import * as repo from "../models/integrations.repository";
import { sendIntegrationEmail } from "./email.service";
import { decryptSecret, encryptSecret, fieldAad, secretHint } from "./integrations.crypto";
import { entityUuid } from "./uuid";
import { klNow } from "./time";

/**
 * Integrations: the credentials half of the app, and the one place plaintext
 * secrets exist — on the way IN. They are encrypted field-by-field before
 * the row is written, and no read path here ever decrypts: clients get
 * `hints` (`••••1234`) and non-secret `settings` only.
 *
 * What a provider accepts is decided entirely by the shared catalogue (field
 * roles): `name` → the row's label column, `config` → `data.settings`,
 * `secret` → encrypted `data.secrets` + a write-time hint.
 */

/** What every client read returns — no secret ever crosses this line. */
export type IntegrationDto = IntegrationRecord;

function toDto(row: IntegrationRow): IntegrationDto {
  const data = row.data;
  return {
    uuid: row.uuid,
    provider: row.provider,
    name: row.name,
    connected: data.connected,
    connectedAt: data.connectedAt,
    settings: { ...data.settings },
    hints: { ...data.hints },
    addedAt: data.createdAt,
  };
}

export async function list(env: Env): Promise<IntegrationDto[]> {
  const rows = await repo.listIntegrations(env);
  return rows.map(toDto);
}

type CreateInput = z.infer<typeof createIntegrationSchema>;
type UpdateInput = z.infer<typeof updateIntegrationSchema>;

/**
 * Create = connect: the form hands over every field the provider asks for,
 * so the instance arrives connected (with `connectedAt` set) — an instance
 * without credentials has no reason to exist yet.
 */
export async function create(env: Env, input: CreateInput): Promise<IntegrationDto> {
  const provider = providerOf(input.provider);
  if (!provider) {
    // The schema already rejects unknown providers; this is belt-and-braces
    // for the typed lookup below.
    throw validationFailed("Check the highlighted fields", { provider: "Unknown provider." });
  }
  if (provider.auth === "google-oauth") {
    throw badRequest(
      "gmail_oauth_only",
      `${provider.label} is connected with Google sign-in, not API keys.`,
    );
  }

  const settings: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  const hints: Record<string, string> = {};
  const uuid = entityUuid("itg");

  const issues: Record<string, string> = {};
  for (const field of provider.fields) {
    if (field.role === "name") continue;
    const value = (input.fields[field.name] ?? "").trim();
    if (field.options && !field.options.includes(value)) {
      issues[`fields.${field.name}`] = `${field.label} must be one of: ${field.options.join(", ")}.`;
      continue;
    }
    if (field.role === "config") {
      settings[field.name] = value;
    } else {
      secrets[field.name] = await encryptSecret(env, fieldAad(uuid, field.name), value);
      hints[field.name] = secretHint(value);
    }
  }

  if (Object.keys(issues).length > 0) {
    throw validationFailed("Check the highlighted fields", issues);
  }

  const now = klNow();
  const data: IntegrationData = {
    connected: true,
    connectedAt: now,
    settings,
    secrets,
    hints,
    createdAt: now,
    updatedAt: now,
  };

  const row = await repo.insertIntegration(env, {
    uuid,
    name: input.name,
    provider: provider.id,
    data,
  });
  return toDto(row);
}

/**
 * Create the Gmail row the OAuth flow confirms. The refresh token arrives
 * plaintext from Google and is encrypted under this row's AAD before it is
 * written; the account email lands in `settings.username` for From.
 */
export async function createGmailOAuth(
  env: Env,
  name: string,
  email: string,
  refreshToken: string,
): Promise<IntegrationDto> {
  const uuid = entityUuid("itg");
  const now = klNow();
  const data: IntegrationData = {
    connected: true,
    connectedAt: now,
    settings: { username: email, auth: "oauth" },
    secrets: { refreshToken: await encryptSecret(env, fieldAad(uuid, "refreshToken"), refreshToken) },
    // No hint: the token is never shown, and its last four characters are
    // meaningless to the merchant.
    hints: {},
    createdAt: now,
    updatedAt: now,
  };
  const row = await repo.insertIntegration(env, { uuid, name, provider: "gmail", data });
  return toDto(row);
}

/**
 * Reconnect: rotate the refresh token (and account address) on an existing
 * Gmail row without touching its name or history.
 */
export async function updateGmailOAuth(
  env: Env,
  uuid: string,
  email: string,
  refreshToken: string,
  name?: string,
): Promise<IntegrationDto> {
  const row = await repo.findIntegration(env, uuid);
  if (!row) throw notFound("not_found", "Integration not found");
  if (row.provider !== "gmail") throw notFound("not_found", "Not a Gmail integration");

  const data: IntegrationData = {
    ...row.data,
    settings: { ...row.data.settings, username: email, auth: "oauth" },
    secrets: {
      ...row.data.secrets,
      refreshToken: await encryptSecret(env, fieldAad(row.uuid, "refreshToken"), refreshToken),
    },
    hints: {},
    connected: true,
    connectedAt: row.data.connectedAt ?? klNow(),
    updatedAt: klNow(),
  };
  const updated = await repo.updateIntegration(env, uuid, {
    name: name?.trim() || row.name,
    data,
  });
  if (!updated) throw notFound("not_found", "Integration not found");
  return toDto(updated);
}

export async function update(
  env: Env,
  uuid: string,
  input: UpdateInput,
): Promise<IntegrationDto> {
  const row = await repo.findIntegration(env, uuid);
  if (!row) throw notFound("not_found", "Integration not found");
  const provider = providerOf(row.provider);
  if (!provider) throw notFound("not_found", "Integration provider no longer exists");

  const data: IntegrationData = { ...row.data, settings: { ...row.data.settings } };
  data.secrets = { ...row.data.secrets };
  data.hints = { ...row.data.hints };

  if (input.fields) {
    // Precise per-row key check: the row's own provider decides what is legal.
    const issues: Record<string, string> = {};
    for (const [key, raw] of Object.entries(input.fields)) {
      const field = provider.fields.find((entry) => entry.name === key);
      if (!field) {
        issues[`fields.${key}`] = `${provider.label} has no field "${key}".`;
        continue;
      }
      if (field.role === "name") {
        issues[`fields.${key}`] = "Name is sent as `name`, not inside `fields`.";
        continue;
      }
      const value = raw.trim();
      if (field.options && !field.options.includes(value)) {
        issues[`fields.${key}`] = `${field.label} must be one of: ${field.options.join(", ")}.`;
        continue;
      }
      if (field.role === "config") {
        data.settings[key] = value;
      } else {
        data.secrets[key] = await encryptSecret(env, fieldAad(row.uuid, key), value);
        data.hints[key] = secretHint(value);
      }
    }
    if (Object.keys(issues).length > 0) {
      throw validationFailed("Check the highlighted fields", issues);
    }
  }

  if (input.connected !== undefined) {
    data.connected = input.connected;
    data.connectedAt = input.connected ? (data.connectedAt ?? klNow()) : null;
  }
  data.updatedAt = klNow();

  const name = input.name !== undefined ? input.name : row.name;
  const updated = await repo.updateIntegration(env, uuid, { name, data });
  if (!updated) throw notFound("not_found", "Integration not found");
  return toDto(updated);
}

export async function remove(env: Env, uuid: string): Promise<void> {
  const existed = await repo.deleteIntegration(env, uuid);
  if (!existed) throw notFound("not_found", "Integration not found");
}

/** What a test email reports back to the caller. */
export interface TestEmailResult {
  sent: boolean;
  to: string;
  subject: string;
}

/** Caller-provided overrides for a test send (all optional). */
export interface TestEmailOverrides {
  recipient?: string;
  subject?: string;
  message?: string;
}

/**
 * Send a "Test Email" from one stored integration to the merchant.
 *
 * The recipient defaults to the signed-in session user (the caller passes it
 * — a request body can never pick it silently), subject/message to the
 * shared defaults; the Gmail section's form overrides all three.
 *
 * Transport switches on the row's provider: Cloudflare goes through its
 * Email Sending REST API, Gmail through the Gmail API with the OAuth refresh
 * token (a dead grant says to Reconnect); anything else is `wrong_provider`.
 * Every refusal surfaces as `502 email_send_failed` with actionable text —
 * never a stored secret.
 */
export async function testEmail(
  env: Env,
  uuid: string,
  sessionUser: { email: string; name: string },
  overrides: TestEmailOverrides = {},
): Promise<TestEmailResult> {
  const row = await repo.findIntegration(env, uuid);
  if (!row) throw notFound("not_found", "Integration not found");
  const provider = providerOf(row.provider);
  if (!provider?.testEmail) {
    const senders = INTEGRATION_PROVIDERS.filter((entry) => entry.testEmail)
      .map((entry) => entry.label)
      .join(" and ");
    throw badRequest("wrong_provider", `Test Email is available for ${senders} integrations.`);
  }

  const recipient = (overrides.recipient ?? "").trim() || sessionUser.email;
  // A subject is a single header line: newlines would be header injection
  // (defense in depth — the schema already trims).
  const subject =
    (overrides.subject ?? "").replace(/[\r\n]+/g, " ").trim() || DEFAULT_EMAIL_SUBJECT;
  // Omitted → a fresh random quote body (different content each send).
  const message = (overrides.message ?? "").trim() || randomEmailBody();

  await sendIntegrationEmail(env, row, { to: recipient, subject, text: message });
  return { sent: true, to: recipient, subject };
}
