import { loginSchema, signupSchema } from "@storesy/shared";
import type { Context } from "../core/context";
import { unauthorized } from "../core/errors";
import * as auth from "../services/auth.service";
import { createSession, revokeSession } from "../services/session.service";

export async function signup(ctx: Context): Promise<Response> {
  const input = await ctx.body(signupSchema);
  const user = await auth.signup(ctx.env, input, ctx.clientIp);
  const token = await createSession(ctx.env, user.id, ctx.userAgent);
  ctx.setSessionCookie(token);
  return ctx.created(user);
}

export async function login(ctx: Context): Promise<Response> {
  const input = await ctx.body(loginSchema);
  const user = await auth.login(ctx.env, input, ctx.clientIp);
  const token = await createSession(ctx.env, user.id, ctx.userAgent);
  ctx.setSessionCookie(token);
  return ctx.json(user);
}

export async function logout(ctx: Context): Promise<Response> {
  if (ctx.session) {
    await revokeSession(ctx.env, ctx.session.token);
  }
  ctx.clearSessionCookie();
  return ctx.noContent();
}

export async function me(ctx: Context): Promise<Response> {
  if (!ctx.session) throw unauthorized();

  const user = await auth.userById(ctx.env, ctx.session.userId);
  if (!user) {
    // User deleted while a session was live: kill the session, force re-login.
    await revokeSession(ctx.env, ctx.session.token);
    ctx.clearSessionCookie();
    throw unauthorized("session_invalid", "Session is no longer valid");
  }

  return ctx.json({ user });
}
