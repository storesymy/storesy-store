import type { DbConfig, DbDataPage, DbStructure, DbTable } from "@storesy/shared";
import type { Context } from "../core/context";
import { forbidden, notFound, unauthorized } from "../core/errors";
import * as db from "../models/db.repository";
import * as auth from "../services/auth.service";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * /system is owner-only: a live session is required, then the account role is
 * checked — a signed-in non-owner gets 403, everyone else 401.
 */
async function requireOwner(ctx: Context): Promise<void> {
  if (!ctx.session) throw unauthorized();
  const user = await auth.userById(ctx.env, ctx.session.userId);
  if (!user) throw unauthorized("session_invalid", "Session is no longer valid");
  if (user.role !== "owner") throw forbidden("forbidden", "Owner access required");
}

/** The table param is only honoured when it exists in sqlite_master (allowlist). */
async function resolveTable(ctx: Context): Promise<string> {
  const name = ctx.params.table ?? "";
  if (!name || !(await db.tableExists(ctx.env, name))) {
    throw notFound("table_not_found", "No such table in this database");
  }
  return name;
}

export async function config(ctx: Context): Promise<Response> {
  await requireOwner(ctx);

  // Local SQLite file vs. Cloudflare D1, decided by where the bytes actually
  // are: miniflare's marker table (local dev) — with production always remote.
  // (`wrangler types` types ENVIRONMENT as the wrangler.jsonc literal;
  // production deploys override it via `--var ENVIRONMENT:production`.)
  const isProduction = (ctx.env.ENVIRONMENT as string) === "production";
  const local = !isProduction && (await db.isLocalMiniflare(ctx.env));

  const payload: DbConfig = {
    storage: local ? "local-sqlite" : "cloudflare-d1",
    location: local
      ? ".wrangler/state/v3/d1/ — SQLite file on this machine"
      : "Cloudflare D1 — managed service, no local file",
    engine: local ? "SQLite (local file)" : "Cloudflare D1 (SQLite)",
    environment: ctx.env.ENVIRONMENT,
    host: local ? "localhost" : ctx.env.DB_HOST || "cloudflare-d1",
    user: ctx.env.DB_USER || "d1-app",
    name: ctx.env.DB_NAME || "storesy",
  };
  return ctx.json(payload);
}

export async function tables(ctx: Context): Promise<Response> {
  await requireOwner(ctx);
  const list: DbTable[] = await db.listTables(ctx.env);
  return ctx.json({ tables: list });
}

export async function structure(ctx: Context): Promise<Response> {
  await requireOwner(ctx);
  const table = await resolveTable(ctx);

  const [info, indexes, foreignKeys] = await Promise.all([
    db.tableInfo(ctx.env, table),
    db.indexList(ctx.env, table),
    db.foreignKeys(ctx.env, table),
  ]);

  const payload: DbStructure = {
    table,
    columns: info.columns,
    indexes,
    foreignKeys,
  };
  return ctx.json(payload);
}

function intParam(url: URL, key: string, fallback: number): number {
  const parsed = Number.parseInt(url.searchParams.get(key) ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function data(ctx: Context): Promise<Response> {
  await requireOwner(ctx);
  const table = await resolveTable(ctx);

  const page = Math.max(1, intParam(ctx.url, "page", 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, intParam(ctx.url, "pageSize", DEFAULT_PAGE_SIZE)));

  const result = await db.tableData(ctx.env, table, pageSize, (page - 1) * pageSize);
  const payload: DbDataPage = {
    table,
    columns: result.columns,
    rows: result.rows,
    total: result.total ?? result.rows.length,
    page,
    pageSize,
  };
  return ctx.json(payload);
}
