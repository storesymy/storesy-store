import {
  acceptInvitationSchema,
  inviteUserSchema,
  updateUserSchema,
} from "@storesy/shared";
import type { Context } from "../core/context";
import * as auth from "../services/auth.service";
import * as permissions from "../services/permissions.service";
import { enforceRateLimit } from "../services/rate-limit.service";
import { createSession } from "../services/session.service";
import * as users from "../services/users.service";

/** GET /api/users — the admin-only user table search + pagination. */
export async function list(ctx: Context): Promise<Response> {
  await permissions.requireMenu(ctx, "users");
  const q = ctx.url.searchParams.get("q") ?? "";
  const page = Number(ctx.url.searchParams.get("page") ?? "1");
  const perPage = Number(ctx.url.searchParams.get("perPage") ?? String(users.USERS_PER_PAGE));
  return ctx.json(
    await users.list(ctx.env, {
      search: q,
      page: Number.isFinite(page) ? page : 1,
      perPage: Number.isFinite(perPage) ? perPage : users.USERS_PER_PAGE,
    }),
  );
}

/** POST /api/invitations — create the pending user and send the 48h link. */
export async function invite(ctx: Context): Promise<Response> {
  const actor = await permissions.requireMenu(ctx, "users");
  const input = await ctx.body(inviteUserSchema);
  return ctx.created({ user: await users.invite(ctx.env, actor, input) });
}

/** GET /api/invitations/:token — public details before accepting. */
export async function invitation(ctx: Context): Promise<Response> {
  return ctx.json(await users.invitationDetails(ctx.env, ctx.params.token ?? ""));
}

/** POST /api/invitations/:token/accept — password set, account active, signed in. */
export async function accept(ctx: Context): Promise<Response> {
  await enforceRateLimit(
    ctx.env,
    `invite-accept:${ctx.clientIp}`,
    20,
    15 * 60 * 1000,
    "Too many invitation attempts. Please try again later.",
  );
  const input = await ctx.body(acceptInvitationSchema);
  const row = await users.accept(ctx.env, ctx.params.token ?? "", input.password);
  const token = await createSession(ctx.env, row.uuid, ctx.userAgent);
  ctx.setSessionCookie(token);
  return ctx.json({ user: auth.toPublicUser(row) });
}

/** PATCH /api/users/:uuid — group / menu access changes. */
export async function update(ctx: Context): Promise<Response> {
  const actor = await permissions.requireMenu(ctx, "users");
  const input = await ctx.body(updateUserSchema);
  return ctx.json({
    user: await users.updateAccess(ctx.env, actor, ctx.params.uuid ?? "", input),
  });
}

/** POST /api/users/:uuid/resend-invite — rotate the token and email again. */
export async function resend(ctx: Context): Promise<Response> {
  const actor = await permissions.requireMenu(ctx, "users");
  await users.resend(ctx.env, actor, ctx.params.uuid ?? "");
  return ctx.noContent();
}

/** DELETE /api/users/:uuid — revoke a pending invitation only. */
export async function revoke(ctx: Context): Promise<Response> {
  const actor = await permissions.requireMenu(ctx, "users");
  await users.revoke(ctx.env, actor, ctx.params.uuid ?? "");
  return ctx.noContent();
}
