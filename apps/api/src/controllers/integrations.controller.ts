import {
  createIntegrationSchema,
  isAdminRole,
  testEmailSchema,
  updateIntegrationSchema,
} from "@storesy/shared";
import type { Context } from "../core/context";
import { fieldErrors } from "../core/context";
import { badRequest, forbidden, unauthorized, validationFailed } from "../core/errors";
import * as auth from "../services/auth.service";
import * as integrations from "../services/integrations.service";

/**
 * Integrations carry live payment and email credentials, so this is the
 * app's first ADMIN-ONLY surface (deliberately stricter than products'
 * "any signed-in account"): no session → 401, role outside the shared
 * ADMIN_ROLES → 403. No response ever carries a secret — reads return the
 * write-time hints instead.
 */
async function requireAdmin(ctx: Context): Promise<{ name: string; email: string }> {
  if (!ctx.session) throw unauthorized();
  const user = await auth.userById(ctx.env, ctx.session.userId);
  if (!user || !isAdminRole(user.role)) {
    throw forbidden("forbidden", "Admin access required");
  }
  return { name: user.name, email: user.email };
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
