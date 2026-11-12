import { z } from "zod";
import { SESSION_TTL_SECONDS } from "./constants";
import { parseCookies, serializeCookie } from "./cookies";
import { badRequest, validationFailed } from "./errors";

export interface SessionInfo {
  userId: string;
  token: string;
  expiresAt: number;
}

export class Context {
  readonly url: URL;
  readonly requestId: string;
  params: Record<string, string> = {};
  session: SessionInfo | null = null;
  /**
   * Platform execution context, attached by the entrypoint — the seam that
   * lets a handler park background work (`ctx.waitUntil`) past the response.
   */
  executionCtx: ExecutionContext | null = null;

  private bodyPromise: Promise<unknown> | undefined;

  constructor(
    readonly req: Request,
    readonly env: Env,
    requestId: string,
    params: Record<string, string> = {},
  ) {
    this.url = new URL(req.url);
    this.requestId = requestId;
    this.params = params;
  }

  get method(): string {
    return this.req.method;
  }

  get clientIp(): string {
    return this.req.headers.get("CF-Connecting-IP") ?? "unknown";
  }

  get userAgent(): string {
    return this.req.headers.get("User-Agent") ?? "";
  }

  /** JSON body validated with a zod schema; throws a 422 with per-field messages. */
  async body<T>(schema: z.ZodType<T>): Promise<T> {
    const raw = await this.rawBody();
    const result = schema.safeParse(raw);
    if (!result.success) {
      throw validationFailed("Check the highlighted fields", fieldErrors(result.error));
    }
    return result.data;
  }

  async rawBody(): Promise<unknown> {
    if (!this.bodyPromise) {
      this.bodyPromise = this.req.json().catch(() => {
        throw badRequest("invalid_json", "Request body must be valid JSON");
      });
    }
    return this.bodyPromise;
  }

  json<T>(data: T, status = 200): Response {
    return Response.json(data, {
      status,
      headers: { "X-Request-Id": this.requestId },
    });
  }

  created<T>(data: T): Response {
    return this.json(data, 201);
  }

  noContent(): Response {
    return new Response(null, { status: 204 });
  }

  /**
   * Background work that must outlive the response but never delay it (visit
   * counting). Falls back to a detached promise where no platform context
   * exists, so the request path behaves the same either way.
   */
  waitUntil(promise: Promise<unknown>): void {
    if (this.executionCtx) {
      this.executionCtx.waitUntil(promise);
    } else {
      void promise.catch((error) => console.error("waituntil_failed", error));
    }
  }

  cookie(name: string): string | null {
    return parseCookies(this.req)[name] ?? null;
  }

  /**
   * `__Host-` prefix (Secure, no Domain) in production; a plain name in local
   * development where the API is reached over plain http via the Vite proxy.
   */
  sessionCookieName(): string {
    return this.isProduction ? "__Host-storesy_sid" : "storesy_sid";
  }

  private get isProduction(): boolean {
    return this.env.ENVIRONMENT !== "development";
  }

  setSessionCookie(token: string): void {
    this.setCookieHeader(
      serializeCookie(this.sessionCookieName(), token, {
        httpOnly: true,
        secure: this.isProduction,
        sameSite: "Lax",
        path: "/",
        maxAge: SESSION_TTL_SECONDS,
      }),
    );
  }

  clearSessionCookie(): void {
    this.setCookieHeader(
      serializeCookie(this.sessionCookieName(), "", {
        httpOnly: true,
        secure: this.isProduction,
        sameSite: "Lax",
        path: "/",
        maxAge: 0,
      }),
    );
  }

  /**
   * The short-lived pointer to a Gmail OAuth flow awaiting Save. HttpOnly and
   * SameSite=Lax so Google's top-level callback can set it and only same-site
   * API reads can send it back.
   */
  gmailPendingCookieName(): string {
    return this.isProduction ? "__Host-storesy_gmail_pending" : "storesy_gmail_pending";
  }

  setGmailPendingCookie(uuid: string): void {
    this.setCookieHeader(
      serializeCookie(this.gmailPendingCookieName(), uuid, {
        httpOnly: true,
        secure: this.isProduction,
        sameSite: "Lax",
        path: "/",
        maxAge: 10 * 60,
      }),
    );
  }

  clearGmailPendingCookie(): void {
    this.setCookieHeader(
      serializeCookie(this.gmailPendingCookieName(), "", {
        httpOnly: true,
        secure: this.isProduction,
        sameSite: "Lax",
        path: "/",
        maxAge: 0,
      }),
    );
  }

  /**
   * Cookies collected during the handler; the entrypoint flushes them onto the
   * final response (multiple Set-Cookie values cannot live on Response.json()).
   */
  readonly pendingCookies: string[] = [];

  private setCookieHeader(value: string): void {
    this.pendingCookies.push(value);
  }
}

/** Flattened `path.to.field → message` map for the error envelope. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_";
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}
