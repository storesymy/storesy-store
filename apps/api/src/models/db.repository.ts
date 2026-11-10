import type { DbColumn, DbForeignKey, DbIndex, DbTable } from "@storesy/shared";

/**
 * Read-only introspection for /system. Raw `env.DB.prepare` only — drizzle cannot
 * express PRAGMA statements or dynamic identifiers, and no user SQL is ever built.
 *
 * Every dynamic identifier goes through `quote()`, and callers must first prove
 * the name exists in sqlite_master (`tableExists`) — allowlist, then escape.
 */
function quote(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

interface MasterRow {
  name: string;
  type: string;
}

/** All user tables and views, alphabetically (sqlite internals excluded). */
export async function listTables(env: Env): Promise<DbTable[]> {
  const res = await env.DB.prepare(
    "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all<MasterRow>();
  const master = res.results ?? [];

  const tables: DbTable[] = [];
  for (const row of master) {
    tables.push({
      name: row.name,
      type: row.type === "view" ? "view" : "table",
      // A broken view or locked table must not take the whole list down.
      rows: await countRows(env, row.name),
    });
  }
  return tables;
}

/** True when the name is a real table/view in this database (the allowlist gate). */
export async function tableExists(env: Env, name: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE name = ? LIMIT 1",
  )
    .bind(name)
    .first();
  return row !== null;
}

/**
 * Physical file backing the database (`PRAGMA database_list`): a path under
 * `.wrangler/state` when miniflare runs the SQLite file locally, empty on
 * remote Cloudflare D1. Null when the PRAGMA is unavailable.
 */
/**
 * True when miniflare is serving a local SQLite file (wrangler dev).
 *
 * D1 authorizes only a few PRAGMAs — `PRAGMA database_list` answers
 * `SQLITE_AUTH`, so the real file path cannot be read. Miniflare's
 * `_cf_METADATA` system table (visible through sqlite_master) is the marker;
 * the controller additionally forces "remote" whenever ENVIRONMENT is
 * production, since an edge Worker has no persistent disk.
 */
export async function isLocalMiniflare(env: Env): Promise<boolean> {
  try {
    const row = await env.DB.prepare(
      "SELECT 1 AS ok FROM sqlite_master WHERE name = '_cf_METADATA' LIMIT 1",
    ).first();
    return row !== null;
  } catch {
    return false;
  }
}

async function countRows(env: Env, table: string): Promise<number | null> {
  try {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${quote(table)}`).first<{
      n: number;
    }>();
    return row?.n ?? null;
  } catch {
    return null;
  }
}

interface TableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

export interface TableInfoResult {
  columns: DbColumn[];
  /** Ordered column names — also the fallback for empty-table data pages. */
  names: string[];
}

export async function tableInfo(env: Env, table: string): Promise<TableInfoResult> {
  const res = await env.DB.prepare(`PRAGMA table_info(${quote(table)})`).all<TableInfoRow>();
  const rows = res.results ?? [];
  return {
    columns: rows.map((row) => ({
      name: row.name,
      type: row.type,
      notnull: row.notnull === 1,
      dflt: row.dflt_value,
      pk: row.pk > 0,
    })),
    names: rows.map((row) => row.name),
  };
}

interface IndexListRow {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

interface IndexInfoRow {
  seqno: number;
  cid: number;
  name: string | null;
}

export async function indexList(env: Env, table: string): Promise<DbIndex[]> {
  const res = await env.DB.prepare(`PRAGMA index_list(${quote(table)})`).all<IndexListRow>();
  const out: DbIndex[] = [];
  for (const index of res.results ?? []) {
    const info = await env.DB.prepare(`PRAGMA index_info(${quote(index.name)})`).all<IndexInfoRow>();
    out.push({
      name: index.name,
      unique: index.unique === 1,
      origin: index.origin,
      columns: (info.results ?? []).map((column) => column.name ?? "(rowid)"),
    });
  }
  return out;
}

interface ForeignKeyRow {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string | null;
  on_update: string;
  on_delete: string;
  match: string;
}

export async function foreignKeys(env: Env, table: string): Promise<DbForeignKey[]> {
  const res = await env.DB.prepare(`PRAGMA foreign_key_list(${quote(table)})`).all<ForeignKeyRow>();
  return (res.results ?? []).map((row) => ({
    table: row.table,
    from: row.from,
    to: row.to,
    onDelete: row.on_delete,
    onUpdate: row.on_update,
  }));
}

/** Hex preview for blob cells; long blobs are truncated with their full size. */
function blobToHex(bytes: Uint8Array): string {
  const head = bytes.subarray(0, 16);
  let hex = "";
  for (const byte of head) hex += byte.toString(16).padStart(2, "0");
  return bytes.length > head.length ? `0x${hex}… (${bytes.length} bytes)` : `0x${hex}`;
}

/** JSON-safe cell value: blobs become hex, anything exotic becomes a string. */
function serialize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof ArrayBuffer) return blobToHex(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) {
    return blobToHex(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  return String(value);
}

export interface TableDataResult {
  /** Column names, in select order. */
  columns: string[];
  /** Rows, positional and aligned to `columns`. */
  rows: unknown[][];
  /** COUNT(*) for the whole table; null when it could not be computed. */
  total: number | null;
}

/** One page of rows, positional and aligned to `columns`. */
export async function tableData(
  env: Env,
  table: string,
  limit: number,
  offset: number,
): Promise<TableDataResult> {
  const res = await env.DB.prepare(`SELECT * FROM ${quote(table)} LIMIT ? OFFSET ?`)
    .bind(limit, offset)
    .all<Record<string, unknown>>();
  const raw = res.results ?? [];

  // Empty page: fall back to PRAGMA for the column order.
  const first = raw[0];
  const columns = first ? Object.keys(first) : (await tableInfo(env, table)).names;
  const rows = raw.map((row) => columns.map((column) => serialize(row[column])));
  const total = (await countRows(env, table)) ?? (raw.length > 0 ? offset + raw.length : 0);

  return { columns, rows, total };
}
