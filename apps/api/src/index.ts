import { Context } from "./core/context";
import { isAppError, notFound } from "./core/errors";
import { methodNotAllowed } from "./core/router";
import { assertOriginAllowed, finalize, preflight } from "./core/security";
import { buildRouter } from "./routes";
import { readSession } from "./services/session.service";

export { SessionDO } from "./durable-objects/session.do";
export { RateLimitDO } from "./durable-objects/rate-limit.do";
export { VisitCounterDO } from "./durable-objects/visit-counter.do";

const router = buildRouter();

async function attachSession(ctx: Context): Promise<void> {
  const token = ctx.cookie(ctx.sessionCookieName());
  if (!token) return;
  try {
    const record = await readSession(ctx.env, token);
    if (record) {
      ctx.session = { userId: record.userId, token, expiresAt: record.expiresAt };
      // Slide the browser cookie alongside the server record, so an active
      // session is never cut short by the login-time Max-Age.
      ctx.setSessionCookie(token);
    }
  } catch (error) {
    // A session lookup failure must never take the request path down:
    // treat it as logged out and let the endpoint answer.
    console.error("session_read_failed", error);
  }
}

function errorResponse(error: unknown): Response {
  if (isAppError(error)) {
    const body = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.fields ? { fields: error.fields } : {}),
      },
    };
    return Response.json(body, { status: error.status, headers: error.headers });
  }

  console.error("unhandled_error", error);
  return Response.json(
    { error: { code: "internal_error", message: "Something went wrong" } },
    { status: 500 },
  );
}

async function handle(
  request: Request,
  env: Env,
  executionCtx?: ExecutionContext,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  let ctx: Context | undefined;

  try {
    if (request.method.toUpperCase() === "OPTIONS") {
      return finalize(preflight(request, env), request, env, requestId);
    }

    assertOriginAllowed(request, env);

    const url = new URL(request.url);
    const match = router.match(request.method, url.pathname);
    if (match.kind === "not_found") throw notFound();
    if (match.kind === "method_not_allowed") throw methodNotAllowed(match.allowed);

    ctx = new Context(request, env, requestId, match.params);
    ctx.executionCtx = executionCtx ?? null;
    await attachSession(ctx);

    const response = await match.handler(ctx);
    return finalize(response, request, env, requestId, ctx.pendingCookies);
  } catch (error) {
    return finalize(errorResponse(error), request, env, requestId, ctx?.pendingCookies ?? []);
  }
}

export default {
  fetch: handle,
} satisfies ExportedHandler<Env>;
