import type { Context } from "../core/context";

/** Uptime canary — no session, no DB, always cheap. */
export async function health(ctx: Context): Promise<Response> {
  return ctx.json({
    status: "ok",
    environment: ctx.env.ENVIRONMENT,
    time: new Date().toISOString(),
  });
}
