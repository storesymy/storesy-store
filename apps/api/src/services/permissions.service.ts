import { canAccessMenu, isAdminRole } from "@storesy/shared";
import type { MenuKey } from "@storesy/shared";
import { forbidden, unauthorized } from "../core/errors";
import type { Context } from "../core/context";
import * as usersRepo from "../models/users.repository";
import type { UserRow } from "../models/schema";

/** The signed-in account, or 401. Pending/deleted accounts never pass. */
export async function requireUser(ctx: Context): Promise<UserRow> {
  if (!ctx.session) throw unauthorized();
  const row = await usersRepo.findUserById(ctx.env, ctx.session.userId);
  if (!row || row.status !== "active") {
    throw unauthorized("session_invalid", "Session is no longer valid");
  }
  return row;
}

export async function requireAdmin(ctx: Context): Promise<UserRow> {
  const row = await requireUser(ctx);
  if (!isAdminRole(row.role)) {
    throw forbidden("forbidden", "Admin access required");
  }
  return row;
}

/**
 * Gate one API surface by the sidebar menu it backs. Owner bypasses the list;
 * admin-only menus stay closed to staff even if a stale row lists them.
 */
export async function requireMenu(ctx: Context, key: MenuKey): Promise<UserRow> {
  const row = await requireUser(ctx);
  if (!canAccessMenu(row.role, row.data?.menuAccess ?? [], key)) {
    throw forbidden("forbidden", "You do not have access to this menu");
  }
  return row;
}
