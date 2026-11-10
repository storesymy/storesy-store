import type { Context } from "./context";
import { AppError, notFound } from "./errors";

export type Handler = (ctx: Context) => Promise<Response> | Response;

interface Route {
  method: string;
  /** Path split into segments. `:name` marks a parameter. */
  segments: string[];
  handler: Handler;
}

export type MatchResult =
  | { kind: "match"; handler: Handler; params: Record<string, string> }
  | { kind: "method_not_allowed"; allowed: string[] }
  | { kind: "not_found" };

function split(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler): this {
    this.routes.push({ method: method.toUpperCase(), segments: split(path), handler });
    return this;
  }

  get(path: string, handler: Handler): this {
    return this.add("GET", path, handler);
  }

  post(path: string, handler: Handler): this {
    return this.add("POST", path, handler);
  }

  put(path: string, handler: Handler): this {
    return this.add("PUT", path, handler);
  }

  patch(path: string, handler: Handler): this {
    return this.add("PATCH", path, handler);
  }

  delete(path: string, handler: Handler): this {
    return this.add("DELETE", path, handler);
  }

  match(method: string, path: string): MatchResult {
    const upperMethod = method.toUpperCase();
    const parts = split(path);
    const allowed = new Set<string>();
    let pathMatched = false;

    for (const route of this.routes) {
      const params = matchSegments(route.segments, parts);
      if (!params) continue;
      pathMatched = true;
      if (route.method === upperMethod) {
        return { kind: "match", handler: route.handler, params };
      }
      allowed.add(route.method);
    }

    if (pathMatched) {
      // Advertise what the path does accept so clients can discover verbs.
      allowed.add("OPTIONS");
      return { kind: "method_not_allowed", allowed: [...allowed].sort() };
    }
    return { kind: "not_found" };
  }
}

function matchSegments(
  routeSegments: string[],
  pathSegments: string[],
): Record<string, string> | null {
  // A trailing `*` swallows every remaining path segment into params["*"].
  if (routeSegments[routeSegments.length - 1] === "*") {
    const fixed = routeSegments.slice(0, -1);
    if (pathSegments.length < fixed.length) return null;
    const params: Record<string, string> = {};
    for (let i = 0; i < fixed.length; i += 1) {
      const routeSegment = fixed[i] as string;
      const pathSegment = pathSegments[i] as string;
      if (routeSegment.startsWith(":")) {
        params[routeSegment.slice(1)] = decodeURIComponent(pathSegment);
      } else if (routeSegment !== pathSegment) {
        return null;
      }
    }
    params["*"] = pathSegments
      .slice(fixed.length)
      .map(decodeURIComponent)
      .join("/");
    return params;
  }

  if (routeSegments.length !== pathSegments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < routeSegments.length; i += 1) {
    const routeSegment = routeSegments[i] as string;
    const pathSegment = pathSegments[i] as string;
    if (routeSegment.startsWith(":")) {
      params[routeSegment.slice(1)] = decodeURIComponent(pathSegment);
    } else if (routeSegment !== pathSegment) {
      return null;
    }
  }
  return params;
}

export function methodNotAllowed(allowed: string[]): AppError {
  return new AppError(405, "method_not_allowed", `Allowed: ${allowed.join(", ")}`, {
    headers: { Allow: allowed.join(", ") },
  });
}

export { notFound };
