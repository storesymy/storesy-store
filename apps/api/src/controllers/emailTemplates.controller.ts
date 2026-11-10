import { updateEmailTemplateSchema } from "@storesy/shared";
import type { Context } from "../core/context";
import { unauthorized } from "../core/errors";
import * as templates from "../services/emailTemplates.service";

/**
 * Email Templates is a normal signed-in page, like products and sales pages:
 * any account can read the messages the store sends and edit their wording.
 * Rows are install-wide — one store, one voice.
 */
function requireSession(ctx: Context): void {
  if (!ctx.session) throw unauthorized();
}

export async function list(ctx: Context): Promise<Response> {
  requireSession(ctx);
  return ctx.json({ templates: await templates.list(ctx.env) });
}

export async function update(ctx: Context): Promise<Response> {
  requireSession(ctx);
  const input = await ctx.body(updateEmailTemplateSchema);
  return ctx.json(await templates.update(ctx.env, ctx.params.uuid ?? "", input));
}
