import { env } from "cloudflare:test";
import { GMAIL_SEND_SCOPE } from "../src/services/gmail.service";
import type { GmailOAuthFetch } from "../src/services/gmail.service";
import {
  GmailOAuthError,
  buildAuthUrl,
  buildGmailRaw,
  googleConfig,
  refreshAccessToken,
  sendGmailEmail,
} from "../src/services/gmail.service";
import * as gmailOAuth from "../src/services/gmailOAuth.service";
import * as flowRepo from "../src/models/gmailOAuth.repository";
import * as integrationRepo from "../src/models/integrations.repository";
import { createGmailOAuth } from "../src/services/integrations.service";
import { fieldAad } from "../src/services/integrations.crypto";
import { sha256Hex } from "../src/services/session.service";
import { describe, expect, it } from "vitest";

/**
 * Gmail is connected with Google OAuth, not an App Password: one sign-in
 * handshake (state → code → refresh token), a confirmation step, then the
 * Gmail API as the send transport. These tests drive the REAL flow code
 * against injected Google responses — no network, no real account.
 */

const ORIGIN = "https://smbiz.pages.dev";
const REDIRECT_URI = `${ORIGIN}/api/integrations/gmail/oauth/callback`;
const CLIENT_ID = "test-client.apps.googleusercontent.com";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Google's two endpoints, in the order the handshake calls them. */
function googleFetch(
  overrides: { token?: Record<string, unknown>; profile?: Record<string, unknown> } = {},
): GmailOAuthFetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com/token")) {
      return jsonResponse(
        overrides.token ?? {
          access_token: "access-token-1",
          refresh_token: "rt-super-secret-value",
          scope: `openid email ${GMAIL_SEND_SCOPE}`,
        },
      );
    }
    if (url.includes("openidconnect.googleapis.com")) {
      return jsonResponse(
        overrides.profile ?? { email: "owner@gmail.com", email_verified: true },
      );
    }
    throw new Error(`unexpected Google call: ${url}`);
  }) as GmailOAuthFetch;
}

async function createUser(): Promise<number> {
  const row = await env.DB.prepare(
    "INSERT INTO users (uuid, email, name, password_hash) VALUES (?, ?, ?, ?) RETURNING id",
  )
    .bind(
      `usr-${crypto.randomUUID()}`,
      `gmail-${crypto.randomUUID()}@example.com`,
      "Gmail Tester",
      "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    )
    .first<{ id: number }>();
  if (!row) throw new Error("user insert returned no row");
  return row.id;
}

/** Start a handshake and return its single-use state. */
async function startState(userId: number, integrationUuid?: string): Promise<string> {
  const start = await gmailOAuth.startFlow(env, userId, REDIRECT_URI, integrationUuid);
  const state = new URL(start.url).searchParams.get("state");
  if (!state) throw new Error("startFlow produced no state");
  return state;
}

describe("gmail OAuth handshake", () => {
  it("mints a consent URL and stores only the state's hash", async () => {
    const userId = await createUser();
    const start = await gmailOAuth.startFlow(env, userId, REDIRECT_URI);

    const url = new URL(start.url);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toContain(GMAIL_SEND_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    const state = url.searchParams.get("state") as string;
    expect(state.length).toBeGreaterThan(20);

    const row = await flowRepo.findByStateHash(env, await sha256Hex(state));
    expect(row).not.toBeNull();
    expect(row?.user_id).toBe(userId);
    expect(row?.data.status).toBe("started");
    // The raw state is never persisted — only its digest.
    expect(JSON.stringify(row)).not.toContain(state);
  });

  it("turns Google's answer into a ready flow without exposing the token", async () => {
    const userId = await createUser();
    const state = await startState(userId);

    const result = await gmailOAuth.handleCallback(
      env,
      userId,
      { code: "code-abc", state },
      REDIRECT_URI,
      googleFetch(),
    );
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;

    const pending = await gmailOAuth.getPending(env, userId, result.uuid);
    expect(pending?.email).toBe("owner@gmail.com");
    expect(pending?.suggestedName).toBe("Gmail");
    expect(pending?.scopes).toContain(GMAIL_SEND_SCOPE);
    expect(pending?.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    // What the dialog shows is never the credential.
    expect(JSON.stringify(pending)).not.toContain("rt-super-secret-value");

    const row = await flowRepo.findByUuid(env, result.uuid);
    expect(row?.data.status).toBe("ready");
    expect(row?.data.refreshToken).toBeTruthy();
    expect(row?.data.refreshToken).not.toBe("rt-super-secret-value");
    expect(JSON.stringify(row)).not.toContain("rt-super-secret-value");
  });

  it("refuses a replayed callback", async () => {
    const userId = await createUser();
    const state = await startState(userId);
    const first = await gmailOAuth.handleCallback(
      env,
      userId,
      { code: "code-abc", state },
      REDIRECT_URI,
      googleFetch(),
    );
    expect(first.kind).toBe("ready");

    const replay = await gmailOAuth.handleCallback(
      env,
      userId,
      { code: "code-abc", state },
      REDIRECT_URI,
      googleFetch(),
    );
    expect(replay.kind).toBe("error");
    if (replay.kind === "error") expect(replay.reason).toContain("already used");
  });

  it("rejects a state that belongs to another admin", async () => {
    const owner = await createUser();
    const intruder = await createUser();
    const state = await startState(owner);

    const result = await gmailOAuth.handleCallback(
      env,
      intruder,
      { code: "code-abc", state },
      REDIRECT_URI,
      googleFetch(),
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.reason).toContain("another session");
  });

  it("reports Google's cancellation instead of throwing", async () => {
    const userId = await createUser();
    const state = await startState(userId);

    const result = await gmailOAuth.handleCallback(
      env,
      userId,
      { error: "access_denied", error_description: "User denied", state },
      REDIRECT_URI,
      googleFetch(),
    );
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.reason).toBe("Google sign-in was cancelled.");
  });

  it("surfaces a missing Google client as a setup error", async () => {
    const bare = { GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "" } as unknown as Env;
    expect(() => googleConfig(bare)).toThrowError(GmailOAuthError);
    try {
      googleConfig(bare);
    } catch (error) {
      expect((error as GmailOAuthError).code).toBe("not_configured");
      expect((error as GmailOAuthError).message).toContain("GOOGLE_CLIENT_ID");
    }
  });

  it("saves the ready flow as an integration row, then deletes the flow", async () => {
    const userId = await createUser();
    const state = await startState(userId);
    const callback = await gmailOAuth.handleCallback(
      env,
      userId,
      { code: "code-abc", state },
      REDIRECT_URI,
      googleFetch(),
    );
    expect(callback.kind).toBe("ready");
    if (callback.kind !== "ready") return;

    const record = await gmailOAuth.completeConnection(env, userId, callback.uuid, "Shop Gmail");
    expect(record.provider).toBe("gmail");
    expect(record.name).toBe("Shop Gmail");
    expect(record.connected).toBe(true);
    expect(record.settings.username).toBe("owner@gmail.com");
    expect(record.settings.auth).toBe("oauth");

    // The credential is on the row, encrypted, and never in a read payload.
    const row = await integrationRepo.findIntegration(env, record.uuid);
    expect(row?.data.secrets.refreshToken).toBeTruthy();
    expect(row?.data.secrets.refreshToken).not.toBe("rt-super-secret-value");
    expect(JSON.stringify(record)).not.toContain("rt-super-secret-value");

    // One-shot: the flow is gone after Save.
    expect(await flowRepo.findByUuid(env, callback.uuid)).toBeNull();
    expect(await gmailOAuth.getPending(env, userId, callback.uuid)).toBeNull();
  });

  it("discards a cancelled handshake without writing a row", async () => {
    const userId = await createUser();
    const state = await startState(userId);
    const callback = await gmailOAuth.handleCallback(
      env,
      userId,
      { code: "code-abc", state },
      REDIRECT_URI,
      googleFetch(),
    );
    expect(callback.kind).toBe("ready");
    if (callback.kind !== "ready") return;

    await gmailOAuth.discardPending(env, userId, callback.uuid);
    expect(await flowRepo.findByUuid(env, callback.uuid)).toBeNull();

    await expect(
      gmailOAuth.completeConnection(env, userId, callback.uuid, "Too late"),
    ).rejects.toThrow(/expired/i);
    expect((await integrationRepo.listIntegrations(env)).every((r) => r.name !== "Too late")).toBe(
      true,
    );
  });

  it("suggests the existing label when reconnecting a saved row", async () => {
    const userId = await createUser();
    const saved = await createGmailOAuth(env, "Orders Mailer", "shop@gmail.com", "refresh-token");
    const uuid = `gpo-${crypto.randomUUID()}`;
    await flowRepo.insertFlow(env, {
      uuid,
      user_id: userId,
      state_hash: crypto.randomUUID(),
      data: {
        status: "ready",
        redirectUri: REDIRECT_URI,
        email: "shop@gmail.com",
        // Already-encrypted shape is irrelevant here: getPending never reads it.
        refreshToken: "v1.dummy.dummy",
        scopes: [GMAIL_SEND_SCOPE],
        integrationUuid: saved.uuid,
      },
      expires_at: "2999-01-01 00:00:00",
      created_at: "2026-11-12 10:00:00",
    });

    const pending = await gmailOAuth.getPending(env, userId, uuid);
    expect(pending?.email).toBe("shop@gmail.com");
    expect(pending?.suggestedName).toBe("Orders Mailer");

    await gmailOAuth.discardPending(env, userId, uuid);
  });
});

describe("gmail transport", () => {
  it("builds a consent URL that can only send, never read", () => {
    const url = new URL(buildAuthUrl(googleConfig(env), "state-123", REDIRECT_URI));
    expect(url.searchParams.get("scope")).toBe(`openid email ${GMAIL_SEND_SCOPE}`);
    expect(url.searchParams.get("scope")).not.toContain("gmail.readonly");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
  });

  it("encodes a message as RFC 2822 inside base64url", () => {
    const raw = buildGmailRaw({
      from: "owner@gmail.com",
      to: "buyer@example.com",
      subject: "Thank you for your order",
      text: "Hello there,\n\nYour payment arrived.",
    });
    expect(raw).not.toContain("+");
    expect(raw).not.toContain("/");
    expect(raw).not.toContain("=");

    const padded = raw.replace(/-/g, "+").replace(/_/g, "/");
    const mime = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    expect(mime).toContain("From: owner@gmail.com");
    expect(mime).toContain("To: buyer@example.com");
    expect(mime).toContain("Subject: Thank you for your order");
    expect(mime).toContain('Content-Type: text/plain; charset="utf-8"');
    expect(mime).toContain("Your payment arrived.");
    expect(mime).toContain("Message-ID: <");
  });

  it("maps a dead refresh token to a reconnect", async () => {
    const config = googleConfig(env);
    const dead = (async () =>
      jsonResponse({ error: "invalid_grant", error_description: "Token has been revoked." })) as GmailOAuthFetch;
    await expect(refreshAccessToken(config, "revoked", dead)).rejects.toThrow(/Reconnect Gmail/);
  });

  it("sends through the Gmail API and reports the sender", async () => {
    const calls: { url: string; body?: string }[] = [];
    const fetchImpl: GmailOAuthFetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
      if (url.includes("oauth2.googleapis.com/token")) {
        return jsonResponse({ access_token: "access-token-9" });
      }
      if (url.includes("gmail.googleapis.com")) {
        return jsonResponse({ id: "msg-1" });
      }
      throw new Error(`unexpected call: ${url}`);
    };

    const result = await sendGmailEmail(
      env,
      "owner@gmail.com",
      "refresh-token",
      { to: "buyer@example.com", subject: "Receipt", text: "Thanks!" },
      fetchImpl,
    );
    expect(result.from).toBe("owner@gmail.com");
    expect(calls).toHaveLength(2);

    const send = calls[1];
    expect(send?.url).toContain("gmail.googleapis.com/gmail/v1/users/me/messages/send");
    const payload = JSON.parse(send?.body ?? "{}") as { raw?: string };
    expect(payload.raw).toBeTruthy();
    const padded = (payload.raw as string).replace(/-/g, "+").replace(/_/g, "/");
    const mime = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    expect(mime).toContain("Subject: Receipt");
    expect(mime).toContain("Thanks!");
  });

  it("maps Gmail's refusals to actionable errors", async () => {
    const unauthorized: GmailOAuthFetch = async (input) =>
      String(input).includes("oauth2.googleapis.com/token")
        ? jsonResponse({ access_token: "at" })
        : jsonResponse({ error: { message: "Invalid Credentials" } }, 401);
    await expect(
      sendGmailEmail(env, "owner@gmail.com", "rt", { to: "a@b.co", subject: "s", text: "t" }, unauthorized),
    ).rejects.toThrow(/Reconnect Gmail/);

    const throttled: GmailOAuthFetch = async (input) =>
      String(input).includes("oauth2.googleapis.com/token")
        ? jsonResponse({ access_token: "at" })
        : jsonResponse({ error: { message: "Quota exceeded" } }, 429);
    await expect(
      sendGmailEmail(env, "owner@gmail.com", "rt", { to: "a@b.co", subject: "s", text: "t" }, throttled),
    ).rejects.toThrow(/rate-limiting/);
  });
});
