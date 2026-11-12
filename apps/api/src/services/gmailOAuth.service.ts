import type { GmailOAuthPending, IntegrationRecord } from "@storesy/shared";
import { notFound } from "../core/errors";
import type { GmailOAuthFlowData, GmailOAuthFlowRow } from "../models/schema";
import * as flowRepo from "../models/gmailOAuth.repository";
import * as integrationRepo from "../models/integrations.repository";
import * as integrations from "./integrations.service";
import {
  GmailOAuthError,
  buildAuthUrl,
  exchangeCode,
  fetchProfile,
  googleConfig,
} from "./gmail.service";
import type { GmailOAuthFetch } from "./gmail.service";
import { decryptSecret, encryptSecret, fieldAad } from "./integrations.crypto";
import { sha256Hex } from "./session.service";
import { ID_PREFIX, entityUuid } from "./uuid";
import { formatKlDateTime, klNow } from "./time";

/**
 * The Gmail sign-in handshake, in three acts:
 *
 *   1. `startFlow`     — mint a single-use `state`, store its hash, hand the
 *                         browser a Google consent URL.
 *   2. `handleCallback`— validate state + admin session, exchange the code,
 *                         read the account email, encrypt the refresh token
 *                         and mark the flow `ready`.
 *   3. `complete`      — the merchant's Save: write the integration row from
 *                        the ready flow and delete it. Cancel or expiry
 *                        simply deletes the row.
 *
 * Nothing here ever returns a token: the confirmation dialog sees only the
 * account email, the granted scopes and a suggested name.
 */

/** Ten minutes for the whole handshake — enough to read a consent screen. */
const FLOW_TTL_MS = 10 * 60 * 1000;

export interface GmailOAuthStart {
  url: string;
}

export interface GmailOAuthCallbackResult {
  /** The flow is `ready`; its uuid rides in the pending cookie. */
  kind: "ready";
  uuid: string;
}

export interface GmailOAuthCallbackFailure {
  kind: "error";
  /** Encoded into the redirect back to /integrations. */
  reason: string;
}

function isExpired(expiresAt: string): boolean {
  const at = Date.parse(`${expiresAt.replace(" ", "T")}+08:00`);
  return !Number.isFinite(at) || at <= Date.now();
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Issue the state row and the Google consent URL for this admin. */
export async function startFlow(
  env: Env,
  userId: number,
  redirectUri: string,
  integrationUuid?: string,
): Promise<GmailOAuthStart> {
  const config = googleConfig(env); // throws not_configured for the UI
  await flowRepo.deleteExpired(env);

  const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const stateHash = await sha256Hex(state);
  const uuid = entityUuid(ID_PREFIX.gmailOAuthFlow);
  const data: GmailOAuthFlowData = {
    status: "started",
    redirectUri,
    ...(integrationUuid ? { integrationUuid } : {}),
  };

  await flowRepo.insertFlow(env, {
    uuid,
    user_id: userId,
    state_hash: stateHash,
    data,
    expires_at: formatKlDateTime(new Date(Date.now() + FLOW_TTL_MS)),
    created_at: klNow(),
  });

  return { url: buildAuthUrl(config, state, redirectUri) };
}

/**
 * Google's return trip. A failure never throws — the caller redirects back to
 * the integrations page with a reason, because this is a browser navigation
 * and the merchant needs to read what went wrong.
 */
export async function handleCallback(
  env: Env,
  userId: number,
  params: { code?: string; state?: string; error?: string; error_description?: string },
  redirectUri: string,
  fetchImpl: GmailOAuthFetch = fetch,
): Promise<GmailOAuthCallbackResult | GmailOAuthCallbackFailure> {
  if (params.error) {
    if (params.error === "access_denied") {
      return { kind: "error", reason: "Google sign-in was cancelled." };
    }
    return {
      kind: "error",
      reason: params.error_description?.trim() || `Google returned ${params.error}.`,
    };
  }
  const { code, state } = params;
  if (!code || !state) {
    return { kind: "error", reason: "Google did not return a sign-in code." };
  }

  const row = await flowRepo.findByStateHash(env, await sha256Hex(state));
  if (!row) {
    return { kind: "error", reason: "That sign-in link expired. Start again." };
  }
  if (row.user_id !== userId) {
    return { kind: "error", reason: "That sign-in belongs to another session." };
  }
  if (isExpired(row.expires_at)) {
    await flowRepo.deleteFlow(env, row.uuid);
    return { kind: "error", reason: "That sign-in expired. Start again." };
  }
  // Single use: the first callback to claim the row wins, a replay loses.
  if (!(await flowRepo.consumeState(env, row.uuid))) {
    return { kind: "error", reason: "That sign-in was already used. Start again." };
  }

  try {
    const config = googleConfig(env);
    const tokens = await exchangeCode(
      config,
      code,
      row.data.redirectUri || redirectUri,
      fetchImpl,
    );
    const profile = await fetchProfile(tokens.accessToken, fetchImpl);
    if (!profile.emailVerified) {
      await flowRepo.deleteFlow(env, row.uuid);
      return { kind: "error", reason: "That Google account has no verified email address." };
    }
    const scopes = tokens.scope.split(/[,\s]+/).filter(Boolean);
    const encrypted = await encryptSecret(
      env,
      fieldAad(row.uuid, "refreshToken"),
      tokens.refreshToken,
    );
    await flowRepo.markReady(env, row.uuid, profile.email, encrypted, scopes);
    return { kind: "ready", uuid: row.uuid };
  } catch (error) {
    // The state is consumed; the merchant must start over on any failure.
    await flowRepo.deleteFlow(env, row.uuid);
    if (error instanceof GmailOAuthError) {
      return { kind: "error", reason: error.message };
    }
    return { kind: "error", reason: "Could not finish Google sign-in. Start again." };
  }
}

/** The confirmation dialog's contents — no token ever crosses this line. */
export async function getPending(
  env: Env,
  userId: number,
  uuid: string,
): Promise<GmailOAuthPending | null> {
  const row = await flowRepo.findByUuid(env, uuid);
  if (!row || row.user_id !== userId || row.data.status !== "ready") return null;
  if (isExpired(row.expires_at)) {
    await flowRepo.deleteFlow(env, uuid);
    return null;
  }
  const data = row.data;
  if (!data.email) return null;

  // Reconnect keeps the merchant's own label; a fresh connect suggests Gmail.
  let suggestedName = "Gmail";
  if (data.integrationUuid) {
    const existing = await integrationRepo.findIntegration(env, data.integrationUuid);
    if (existing && existing.provider === "gmail") suggestedName = existing.name;
  }

  return {
    email: data.email,
    scopes: data.scopes ?? [],
    suggestedName,
    expiresAt: row.expires_at,
  };
}

/** Save: write the integration row from the ready flow, then delete the flow. */
export async function completeConnection(
  env: Env,
  userId: number,
  uuid: string,
  name: string,
): Promise<IntegrationRecord> {
  const row = await flowRepo.findByUuid(env, uuid);
  if (!row || row.user_id !== userId || row.data.status !== "ready") {
    throw notFound("gmail_oauth_expired", "That Gmail connection expired. Sign in again.");
  }
  if (isExpired(row.expires_at)) {
    await flowRepo.deleteFlow(env, uuid);
    throw notFound("gmail_oauth_expired", "That Gmail connection expired. Sign in again.");
  }

  const data = row.data;
  if (!data.email || !data.refreshToken) {
    await flowRepo.deleteFlow(env, uuid);
    throw notFound("gmail_oauth_expired", "That Gmail connection is incomplete. Sign in again.");
  }
  const refreshToken = await decryptSecret(
    env,
    fieldAad(row.uuid, "refreshToken"),
    data.refreshToken,
  );

  const record = data.integrationUuid
    ? await integrations.updateGmailOAuth(env, data.integrationUuid, data.email, refreshToken, name)
    : await integrations.createGmailOAuth(env, name, data.email, refreshToken);

  await flowRepo.deleteFlow(env, uuid);
  return record;
}

/** Cancel: drop the pending row (and its encrypted token) immediately. */
export async function discardPending(env: Env, userId: number, uuid: string): Promise<void> {
  const row: GmailOAuthFlowRow | null = await flowRepo.findByUuid(env, uuid);
  if (row && row.user_id === userId) await flowRepo.deleteFlow(env, uuid);
}
