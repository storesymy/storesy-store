import {
  completeGmailOAuthSchema,
  createIntegrationSchema,
  isAdminRole,
  startGmailOAuthSchema,
  testEmailSchema,
  updateIntegrationSchema,
} from "@storesy/shared";
import type { Context } from "../core/context";
import { fieldErrors } from "../core/context";
import { badRequest, forbidden, notFound, unauthorized, validationFailed } from "../core/errors";
import * as usersRepo from "../models/users.repository";
import { GmailOAuthError } from "../services/gmail.service";
import * as gmailOAuth from "../services/gmailOAuth.service";
import * as integrations from "../services/integrations.service";

/**
 * Integrations carry live payment and email credentials, so this is the
 * app's first ADMIN-ONLY surface (deliberately stricter than products'
 * "any signed-in account"): no session → 401, role outside the shared
 * ADMIN_ROLES → 403. No response ever carries a secret — reads return the
 * write-time hints instead.
 */
async function requireAdmin(ctx: Context): Promise<{ id: number; name: string; email: string }> {
  if (!ctx.session) throw unauthorized();
  // The repository row, not the public User: the flow table references the
  // numeric users.id, while the public id is the usr-… uuid.
  const user = await usersRepo.findUserById(ctx.env, ctx.session.userId);
  if (!user || !isAdminRole(user.role)) {
    throw forbidden("forbidden", "Admin access required");
  }
  return { id: user.id, name: user.name, email: user.email };
}

export async function list(ctx: Context): Promise<Response> {
  await requireAdmin(ctx);
  return ctx.json({ integrations: await integrations.list(ctx.env) });
}

export async function create(ctx: Context): Promise<Response> {
  await requireAdmin(ctx);
  const input = await ctx.body(createIntegrationSchema);
  return ctx.created(await integrations.create(ctx.env, input));
}

export async function update(ctx: Context): Promise<Response> {
  await requireAdmin(ctx);
  const input = await ctx.body(updateIntegrationSchema);
  return ctx.json(await integrations.update(ctx.env, ctx.params.uuid ?? "", input));
}

export async function remove(ctx: Context): Promise<Response> {
  await requireAdmin(ctx);
  await integrations.remove(ctx.env, ctx.params.uuid ?? "");
  return ctx.noContent();
}

/**
 * Test Email: sends to the SESSION user's address — subject and quote body
 * address — the recipient comes from the server-side session, never the body.
 * Provider refusals (onboarding, permissions) surface as `502` with
 * Cloudflare's reason, so the modal can show exactly what to fix.
 */
export async function testEmail(ctx: Context): Promise<Response> {
  const user = await requireAdmin(ctx);
  // Body is optional: the Cloudflare button posts `{}`; the Gmail section
  // posts its three fields. Read it directly (ctx.body would force one).
  const text = await ctx.req.text();
  let raw: unknown = {};
  if (text.trim() !== "") {
    try {
      raw = JSON.parse(text);
    } catch {
      throw badRequest("invalid_json", "Request body must be valid JSON");
    }
  }
  const parsed = testEmailSchema.safeParse(raw);
  if (!parsed.success) {
    throw validationFailed("Check the highlighted fields", fieldErrors(parsed.error));
  }
  return ctx.json(
    await integrations.testEmail(ctx.env, ctx.params.uuid ?? "", user, parsed.data),
  );
}

/** The exact Pages origin Google must return to for this request. */
function callbackUri(ctx: Context): string {
  return `${ctx.url.origin}/api/integrations/gmail/oauth/callback`;
}

/**
 * Google's return trip is a browser navigation, not an API call: it answers
 * with a tiny HTML page that auto-redirects back to /integrations (the Pages
 * Function follows 3xx itself, so a 302 here would never reach the browser).
 * The pending cookie is set on this response, before the redirect fires.
 */
function callbackPage(location: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0;url=${location}">
<title>Connecting Gmail…</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
         background:#f4f6fb; color:#1d2433; }
  .card { display:grid; justify-items:center; gap:14px; padding:28px 32px;
          background:#fff; border:1px solid #e3e8f2; border-radius:14px;
          box-shadow:0 8px 24px rgba(20,30,60,.08); }
  .spin { width:30px; height:30px; border-radius:50%;
          border:3px solid #e6eaf4; border-top-color:#e8590c;
          animation:spin .8s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  p { margin:0; color:#5b657a; font-size:14px; }
  a { color:#e8590c; }
</style>
</head>
<body>
  <div class="card">
    <div class="spin" role="status" aria-label="Connecting Gmail"></div>
    <p>Connecting your Gmail account…</p>
    <noscript><p><a href="${location}">Continue to Storesy</a></p></noscript>
  </div>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

function errorPage(reason: string): Response {
  const location = `/integrations?gmail=error&reason=${encodeURIComponent(reason)}`;
  return callbackPage(location);
}

/** POST /api/integrations/gmail/oauth/start → the Google consent URL. */
export async function gmailStart(ctx: Context): Promise<Response> {
  const admin = await requireAdmin(ctx);
  const input = await ctx.body(startGmailOAuthSchema);
  try {
    const start = await gmailOAuth.startFlow(
      ctx.env,
      admin.id,
      callbackUri(ctx),
      input.integrationUuid,
    );
    return ctx.json(start);
  } catch (error) {
    if (error instanceof GmailOAuthError && error.code === "not_configured") {
      throw badRequest(error.code, error.message);
    }
    throw error;
  }
}

/** GET /api/integrations/gmail/oauth/callback — Google's return trip. */
export async function gmailCallback(ctx: Context): Promise<Response> {
  const params = ctx.url.searchParams;
  const query = {
    code: params.get("code") ?? undefined,
    state: params.get("state") ?? undefined,
    error: params.get("error") ?? undefined,
    error_description: params.get("error_description") ?? undefined,
  };

  if (!ctx.session) return errorPage("Your session expired. Sign in again and retry.");
  const user = ctx.session.userId
    ? await usersRepo.findUserById(ctx.env, ctx.session.userId)
    : null;
  if (!user || !isAdminRole(user.role)) return errorPage("Admin access required.");

  const result = await gmailOAuth.handleCallback(
    ctx.env,
    user.id,
    query,
    callbackUri(ctx),
  );
  if (result.kind === "ready") {
    ctx.setGmailPendingCookie(result.uuid);
    return callbackPage("/integrations?gmail=connected");
  }
  return errorPage(result.reason);
}

/** GET /api/integrations/gmail/oauth/pending — the confirmation dialog's data. */
export async function gmailPending(ctx: Context): Promise<Response> {
  const admin = await requireAdmin(ctx);
  const uuid = ctx.cookie(ctx.gmailPendingCookieName()) ?? "";
  if (uuid === "") {
    throw notFound("gmail_oauth_expired", "No Gmail connection is waiting. Sign in again.");
  }
  const pending = await gmailOAuth.getPending(ctx.env, admin.id, uuid);
  if (!pending) {
    ctx.clearGmailPendingCookie();
    throw notFound("gmail_oauth_expired", "That Gmail connection expired. Sign in again.");
  }
  return ctx.json(pending);
}

/** POST /api/integrations/gmail/oauth/complete — the merchant's Save. */
export async function gmailComplete(ctx: Context): Promise<Response> {
  const admin = await requireAdmin(ctx);
  const input = await ctx.body(completeGmailOAuthSchema);
  const uuid = ctx.cookie(ctx.gmailPendingCookieName()) ?? "";
  if (uuid === "") {
    throw notFound("gmail_oauth_expired", "No Gmail connection is waiting. Sign in again.");
  }
  try {
    const record = await gmailOAuth.completeConnection(ctx.env, admin.id, uuid, input.name);
    return ctx.json(record);
  } finally {
    // Success deletes the row; any failure still drops the pointer so the
    // dialog cannot retry a flow that is no longer valid.
    ctx.clearGmailPendingCookie();
  }
}

/** DELETE /api/integrations/gmail/oauth/pending — cancel without saving. */
export async function gmailDiscard(ctx: Context): Promise<Response> {
  const admin = await requireAdmin(ctx);
  const uuid = ctx.cookie(ctx.gmailPendingCookieName()) ?? "";
  if (uuid !== "") await gmailOAuth.discardPending(ctx.env, admin.id, uuid);
  ctx.clearGmailPendingCookie();
  return ctx.noContent();
}
