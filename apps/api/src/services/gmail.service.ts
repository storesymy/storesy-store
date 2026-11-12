import { badRequest } from "../core/errors";

/**
 * Google OAuth + Gmail API — the send transport for Gmail connections.
 *
 * The OAuth app is shared by every deployment; each environment supplies its
 * own GOOGLE_CLIENT_ID/SECRET and registers its Pages origin as a redirect
 * URI. Only `gmail.send` is requested: Storesy can send mail but never reads
 * the mailbox.
 *
 * Tokens are short-lived and are never stored here. Integrations keep only
 * the refresh token (encrypted); an access token is minted per send.
 */

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
export const GMAIL_SEND_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

const OAUTH_SCOPES = ["openid", "email", GMAIL_SEND_SCOPE];

/** Why a Google call failed, in words the UI can show. */
export class GmailOAuthError extends Error {
  constructor(
    readonly code:
      | "not_configured"
      | "invalid_state"
      | "access_denied"
      | "invalid_grant"
      | "invalid_client"
      | "redirect_uri_mismatch"
      | "profile_failed"
      | "send_failed"
      | "rate_limited"
      | "reconnect_required",
    message: string,
  ) {
    super(message);
    this.name = "GmailOAuthError";
  }
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
}

/** Injectable so tests can drive the real code against fake Google. */
export type GmailOAuthFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type FetchLike = GmailOAuthFetch;

/**
 * The shared Google OAuth client. Missing config is a setup error, not a
 * crash: the connect dialog shows exactly what to set.
 */
export function googleConfig(env: Env): GoogleOAuthConfig {
  const clientId = (env.GOOGLE_CLIENT_ID ?? "").trim();
  const clientSecret = (env.GOOGLE_CLIENT_SECRET ?? "").trim();
  if (clientId === "" || clientSecret === "") {
    throw new GmailOAuthError(
      "not_configured",
      "Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on this Worker.",
    );
  }
  return { clientId, clientSecret };
}

/** Map Google's OAuth error codes to actionable merchant-facing text. */
function oauthErrorMessage(code: string | undefined, description: string | undefined): string {
  const detail = description?.trim() ? ` Google said: ${description}` : "";
  switch (code) {
    case "access_denied":
      return "Google sign-in was cancelled. Try again and approve access to send email.";
    case "invalid_grant":
      return "Gmail access expired or was revoked. Reconnect Gmail.";
    case "invalid_client":
      return "Google rejected the OAuth client ID/secret for this deployment.";
    case "redirect_uri_mismatch":
      return (
        "Google rejected the callback URL. Add this deployment's " +
        "/api/integrations/gmail/callback to the OAuth client's Authorized redirect URIs."
      );
    default:
      return `Google could not complete sign-in${detail}`;
  }
}

/**
 * The browser URL the merchant is sent to. `access_type=offline` +
 * `prompt=consent` guarantee a refresh token even on re-authorization.
 */
export function buildAuthUrl(config: GoogleOAuthConfig, state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: OAUTH_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

/** Exchange the callback code for tokens. Throws GmailOAuthError on refusal. */
export async function exchangeCode(
  config: GoogleOAuthConfig,
  code: string,
  redirectUri: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ accessToken: string; refreshToken: string; scope: string }> {
  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
  } catch {
    throw new GmailOAuthError("send_failed", "Could not reach Google to finish sign-in.");
  }

  const payload = await readJson(response);
  const error = typeof payload.error === "string" ? payload.error : undefined;
  if (!response.ok || error) {
    throw new GmailOAuthError(
      error === "invalid_grant"
        ? "invalid_grant"
        : error === "invalid_client"
          ? "invalid_client"
          : error === "redirect_uri_mismatch"
            ? "redirect_uri_mismatch"
            : "send_failed",
      oauthErrorMessage(error, typeof payload.error_description === "string" ? payload.error_description : undefined),
    );
  }

  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token : "";
  const scope = typeof payload.scope === "string" ? payload.scope : "";
  if (accessToken === "" || refreshToken === "") {
    throw new GmailOAuthError(
      "invalid_grant",
      "Google did not grant offline access. Try again and approve the requested permissions.",
    );
  }
  return { accessToken, refreshToken, scope };
}

/** The Gmail address behind the connection — used for From and the UI. */
export async function fetchProfile(
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ email: string; emailVerified: boolean }> {
  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new GmailOAuthError("profile_failed", "Could not read the Google account details.");
  }

  const payload = await readJson(response);
  if (!response.ok) {
    throw new GmailOAuthError(
      "profile_failed",
      "Google did not return the account email. Try signing in again.",
    );
  }
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  if (email === "") {
    throw new GmailOAuthError("profile_failed", "Google did not return an email address.");
  }
  return { email, emailVerified: payload.email_verified === true || payload.email_verified === "true" };
}

/** Mint a short-lived access token from the stored refresh token. */
export async function refreshAccessToken(
  config: GoogleOAuthConfig,
  refreshToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
      }).toString(),
    });
  } catch {
    throw new GmailOAuthError("send_failed", "Could not reach Google to refresh Gmail access.");
  }

  const payload = await readJson(response);
  const error = typeof payload.error === "string" ? payload.error : undefined;
  if (!response.ok || error) {
    if (error === "invalid_grant") {
      throw new GmailOAuthError(
        "reconnect_required",
        "Gmail access expired or was revoked. Reconnect Gmail.",
      );
    }
    throw new GmailOAuthError("send_failed", oauthErrorMessage(error, undefined));
  }
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  if (accessToken === "") {
    throw new GmailOAuthError("send_failed", "Google returned an empty access token.");
  }
  return accessToken;
}

function encodeHeaderValue(value: string): string {
  const folded = value.replace(/[\r\n]+/g, " ").trim();
  // eslint-disable-next-line no-control-regex
  if (/^[\u0000-\u007F]*$/.test(folded)) return folded;
  const bytes = new TextEncoder().encode(folded);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * One plain-text message as RFC 2822, base64url for Gmail's `raw` field.
 * No SMTP dot-stuffing — Gmail API takes the MIME document as-is.
 */
export function buildGmailRaw(message: {
  from: string;
  to: string;
  subject: string;
  text: string;
}): string {
  const isAscii = /^[\u0000-\u007F]*$/.test(message.text);
  const realm = (message.from.split("@")[1] ?? "gmail.com").toLowerCase();
  const headers = [
    `From: ${encodeHeaderValue(message.from)}`,
    `To: ${encodeHeaderValue(message.to)}`,
    `Subject: ${encodeHeaderValue(message.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${realm}>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    `Content-Transfer-Encoding: ${isAscii ? "7bit" : "8bit"}`,
  ].join("\r\n");
  const mime = `${headers}\r\n\r\n${message.text.replace(/\r\n?|\n/g, "\r\n")}`;
  return base64Url(new TextEncoder().encode(mime));
}

/**
 * Send one message through the Gmail API. The refresh token is exchanged for
 * an access token here; nothing is persisted.
 */
export async function sendGmailEmail(
  env: Env,
  from: string,
  refreshToken: string,
  message: { to: string; subject: string; text: string },
  fetchImpl: FetchLike = fetch,
): Promise<{ from: string }> {
  if (from.trim() === "") {
    throw new GmailOAuthError("send_failed", "This Gmail integration has no account address stored.");
  }
  const config = googleConfig(env);
  const accessToken = await refreshAccessToken(config, refreshToken, fetchImpl);

  let response: Response;
  try {
    response = await fetchImpl(GMAIL_SEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: buildGmailRaw({ from, ...message }) }),
    });
  } catch {
    throw new GmailOAuthError("send_failed", "Could not reach Gmail to send the email.");
  }

  const payload = await readJson(response);
  if (response.status === 401) {
    throw new GmailOAuthError("reconnect_required", "Gmail access expired or was revoked. Reconnect Gmail.");
  }
  if (response.status === 429) {
    throw new GmailOAuthError(
      "rate_limited",
      "Gmail is rate-limiting this account right now — wait a few minutes and retry.",
    );
  }
  if (!response.ok) {
    const error = payload.error as { message?: string } | undefined;
    const reason = typeof error?.message === "string" ? error.message : `Gmail responded ${response.status}`;
    throw new GmailOAuthError("send_failed", `Gmail refused the email: ${reason}`);
  }
  return { from };
}

/** Config/setup errors the connect endpoint surfaces directly. */
export function oauthSetupError(error: unknown): never {
  if (error instanceof GmailOAuthError && error.code === "not_configured") {
    throw badRequest(error.code, error.message);
  }
  throw error;
}
