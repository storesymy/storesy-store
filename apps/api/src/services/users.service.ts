import {
  GROUP_DEFAULT_MENUS,
  formatUserNo,
  isAdminOnlyMenu,
} from "@storesy/shared";
import type {
  InvitationDetails,
  InviteUserInput,
  MenuKey,
  UpdateUserInput,
  User,
  UserListRow,
  UserPage,
} from "@storesy/shared";
import { AppError, badRequest, conflict, forbidden, notFound } from "../core/errors";
import * as integrationsRepo from "../models/integrations.repository";
import type { UserRow } from "../models/schema";
import * as usersRepo from "../models/users.repository";
import { toPublicUser } from "./auth.service";
import { sendIntegrationEmail } from "./email.service";
import type { EmailMessage } from "./email.service";
import { defaultIterations, hashPassword } from "./password";
import { sha256Hex } from "./session.service";
import { klNow } from "./time";
import { entityUuid, ID_PREFIX } from "./uuid";

export const USERS_PER_PAGE = 30;
const MAX_PER_PAGE = 100;
const INVITE_HOURS = 48;

type Send = typeof sendIntegrationEmail;

function inviteExpiry(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000 + INVITE_HOURS * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

function newInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function inviteLink(env: Env, token: string): string {
  return `${env.WEB_ORIGIN.replace(/\/+$/, "")}/invite/${token}`;
}

function isExpired(row: UserRow): boolean {
  return (
    row.status === "invited" &&
    row.inviteExpiresAt !== null &&
    row.inviteExpiresAt < klNow()
  );
}

export function toListRow(row: UserRow): UserListRow {
  return {
    ...toPublicUser(row),
    userNo: formatUserNo(row.id),
    statusLabel:
      row.status === "active" ? "Active" : isExpired(row) ? "Expired" : "Invited",
  };
}

export async function list(
  env: Env,
  params: { search?: string; page?: number; perPage?: number } = {},
): Promise<UserPage> {
  const perPage = Math.min(Math.max(params.perPage ?? USERS_PER_PAGE, 1), MAX_PER_PAGE);
  const total = await usersRepo.countUsersMatching(env, params.search);
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(params.page ?? 1, 1), pageCount);
  const rows = await usersRepo.listUsersPage(env, {
    search: params.search,
    page,
    perPage,
  });
  return { users: rows.map(toListRow), total, page, perPage };
}

/** Never trust a client to grant admin-only menus to staff. */
function normalizeMenuAccess(role: string, requested: MenuKey[]): MenuKey[] {
  const unique = [...new Set(requested)];
  if (role === "staff") return unique.filter((key) => !isAdminOnlyMenu(key));
  return unique;
}

function assertCanManage(actor: UserRow, target: UserRow): void {
  if (target.role === "owner") {
    throw forbidden("owner_protected", "The owner account cannot be changed here.");
  }
  if (actor.role !== "owner" && target.role === "admin") {
    throw forbidden("admin_required", "Only the owner can manage another admin.");
  }
}

async function emailSender(env: Env): Promise<import("../models/schema").IntegrationRow> {
  const sender = await integrationsRepo.findFirstEmailIntegration(env);
  if (!sender) {
    throw badRequest(
      "email_sender_missing",
      "Connect a Gmail or Cloudflare Email integration before inviting users.",
    );
  }
  return sender;
}

async function sendInvite(
  env: Env,
  row: UserRow,
  inviter: UserRow,
  token: string,
  send: Send,
): Promise<void> {
  const sender = await emailSender(env);
  const link = inviteLink(env, token);
  const group = row.role === "admin" ? "Admin" : "Staff";
  const message: EmailMessage = {
    to: row.email,
    subject: "You're invited to Storesy",
    text: [
      `Hi ${row.name},`,
      "",
      `${inviter.name} invited you to Storesy as ${group}.`,
      "",
      "Open this link to review your access and set a password:",
      link,
      "",
      `This invitation expires in ${INVITE_HOURS} hours.`,
      "",
      "If you were not expecting this invitation, you can ignore this email.",
    ].join("\n"),
  };

  await send(env, sender, message);
}

export interface UserDeps {
  send?: Send;
}

export async function invite(
  env: Env,
  inviter: UserRow,
  input: InviteUserInput,
  deps: UserDeps = {},
): Promise<User> {
  const email = usersRepo.normalizeEmail(input.email);
  const existing = await usersRepo.findUserByEmail(env, email);
  if (existing) {
    throw conflict(
      existing.status === "invited" ? "already_invited" : "email_exists",
      existing.status === "invited"
        ? "That email already has a pending invitation. Use Manage → Resend."
        : "An account with that email already exists.",
    );
  }
  if (inviter.role !== "owner" && input.role === "admin") {
    throw forbidden("admin_required", "Only the owner can invite another admin.");
  }

  const token = newInviteToken();
  const row = await usersRepo.insertUser(env, {
    uuid: entityUuid(ID_PREFIX.user),
    email,
    name: input.name.trim(),
    passwordHash: "",
    role: input.role,
    status: "invited",
    data: { menuAccess: normalizeMenuAccess(input.role, input.menuAccess) },
    inviteTokenHash: await sha256Hex(token),
    inviteExpiresAt: inviteExpiry(),
    invitedBy: inviter.id,
    updatedAt: klNow(),
  });
  try {
    await sendInvite(env, row, inviter, token, deps.send ?? sendIntegrationEmail);
  } catch (error) {
    // Nothing was delivered, so no live invite should be left behind.
    await usersRepo.deleteUser(env, row.id);
    throw error;
  }
  return toPublicUser(row);
}

/** Hash a token once and return the pending row, or a friendly 404/410. */
async function pendingByToken(env: Env, token: string): Promise<UserRow> {
  const row = await usersRepo.findUserByInviteTokenHash(env, await sha256Hex(token));
  if (!row || row.status !== "invited") {
    throw notFound("invitation_not_found", "This invitation link is no longer valid.");
  }
  if (isExpired(row)) {
    throw new AppError(
      410,
      "invitation_expired",
      "This invitation has expired. Ask an admin to send a new one.",
    );
  }
  return row;
}

export async function invitationDetails(
  env: Env,
  token: string,
): Promise<InvitationDetails> {
  const row = await pendingByToken(env, token);
  return {
    name: row.name,
    email: row.email,
    role: row.role === "admin" ? "admin" : "staff",
    menuAccess: row.data.menuAccess ?? [],
    expiresAt: row.inviteExpiresAt ?? "",
  };
}

/** Accept an invite: set the password, activate the account. */
export async function accept(
  env: Env,
  token: string,
  password: string,
): Promise<UserRow> {
  const row = await pendingByToken(env, token);
  const passwordHash = await hashPassword(password, defaultIterations(env));
  const updated = await usersRepo.updateUser(env, row.id, {
    passwordHash,
    status: "active",
    inviteTokenHash: null,
    inviteExpiresAt: null,
    updatedAt: klNow(),
  });
  if (!updated) throw notFound("invitation_not_found", "This invitation link is no longer valid.");
  return updated;
}

export async function updateAccess(
  env: Env,
  actor: UserRow,
  uuid: string,
  input: UpdateUserInput,
): Promise<User> {
  const target = await usersRepo.findUserById(env, uuid);
  if (!target) throw notFound("user_not_found", "No user with that id");
  assertCanManage(actor, target);
  if (actor.role !== "owner" && input.role === "admin") {
    throw forbidden("admin_required", "Only the owner can promote an admin.");
  }

  const role = input.role ?? target.role;
  const menuAccess =
    input.menuAccess !== undefined
      ? normalizeMenuAccess(role, input.menuAccess)
      : role !== target.role
        ? normalizeMenuAccess(
            role,
            GROUP_DEFAULT_MENUS[role as "admin" | "staff"] ?? [],
          )
        : normalizeMenuAccess(role, target.data.menuAccess ?? []);

  const updated = await usersRepo.updateUser(env, target.id, {
    role,
    data: { menuAccess },
    updatedAt: klNow(),
  });
  if (!updated) throw notFound("user_not_found", "No user with that id");
  return toPublicUser(updated);
}

export async function resend(
  env: Env,
  actor: UserRow,
  uuid: string,
  deps: UserDeps = {},
): Promise<void> {
  const target = await usersRepo.findUserById(env, uuid);
  if (!target) throw notFound("user_not_found", "No user with that id");
  assertCanManage(actor, target);
  if (target.status !== "invited") {
    throw badRequest("not_invited", "That user has already accepted their invitation.");
  }

  const token = newInviteToken();
  // Email first: a failed send must leave the previous link usable.
  await sendInvite(env, target, actor, token, deps.send ?? sendIntegrationEmail);
  const updated = await usersRepo.updateUser(env, target.id, {
    inviteTokenHash: await sha256Hex(token),
    inviteExpiresAt: inviteExpiry(),
    updatedAt: klNow(),
  });
  if (!updated) throw notFound("user_not_found", "No user with that id");
}

export async function revoke(env: Env, actor: UserRow, uuid: string): Promise<void> {
  const target = await usersRepo.findUserById(env, uuid);
  if (!target) throw notFound("user_not_found", "No user with that id");
  assertCanManage(actor, target);
  if (target.status !== "invited") {
    throw badRequest("not_invited", "Only a pending invitation can be revoked.");
  }
  await usersRepo.deleteUser(env, target.id);
}
