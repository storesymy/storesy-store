import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import * as integrationsRepo from "../src/models/integrations.repository";
import * as usersRepo from "../src/models/users.repository";
import * as auth from "../src/services/auth.service";
import * as users from "../src/services/users.service";
import { seedSession } from "./helpers";

const ORIGIN = "http://example.com";
let ownerCookie: string;
let ownerId: string;

beforeAll(async () => {
  const owner = await seedSession("owner");
  ownerCookie = owner.cookie;
  ownerId = owner.uuid;
  const now = "2026-11-27 09:00:00";
  // A connected Cloudflare row without a sender address exists too; Gmail must
  // still win as the invitation sender.
  await integrationsRepo.insertIntegration(env, {
    uuid: `itg-${crypto.randomUUID()}`,
    name: "Cloudflare First",
    provider: "cloudflare",
    data: {
      connected: true,
      connectedAt: now,
      settings: { accountId: "account-1" },
      secrets: {},
      hints: {},
      createdAt: now,
      updatedAt: now,
    },
  });
  await integrationsRepo.insertIntegration(env, {
    uuid: `itg-${crypto.randomUUID()}`,
    name: "Invite Sender",
    provider: "gmail",
    data: {
      connected: true,
      connectedAt: now,
      settings: { username: "owner@store.test", auth: "oauth" },
      secrets: {},
      hints: {},
      createdAt: now,
      updatedAt: now,
    },
  });
});

function captureSend() {
  const messages: Array<{
    to: string;
    subject: string;
    text: string;
    provider: string;
  }> = [];
  return {
    messages,
    send: async (
      _env: Env,
      row: { provider: string },
      message: { to: string; subject: string; text: string },
    ) => {
      messages.push({ ...message, provider: row.provider });
      return { from: "owner@store.test" };
    },
  };
}

function tokenFrom(text: string): string {
  const match = /\/invite\/([A-Za-z0-9_-]+)/.exec(text);
  if (!match?.[1]) throw new Error("invite link missing");
  return match[1];
}

async function ownerRow() {
  const row = await usersRepo.findUserById(env, ownerId);
  if (!row) throw new Error("owner missing");
  return row;
}

describe("user invitations", () => {
  it("creates a 48-hour pending user and emails the link", async () => {
    const send = captureSend();
    const created = await users.invite(
      env,
      await ownerRow(),
      {
        name: "Staff One",
        email: "staff-one@store.test",
        role: "staff",
        menuAccess: ["dashboard", "products", "integrations"],
      },
      { send: send.send },
    );

    expect(created.status).toBe("invited");
    expect(created.role).toBe("staff");
    // The admin-only Integrations menu is dropped for staff.
    expect(created.menuAccess).toEqual(["dashboard", "products"]);
    expect(created.inviteExpiresAt).toBeTruthy();

    const row = await usersRepo.findUserByEmail(env, "staff-one@store.test");
    expect(row?.status).toBe("invited");
    expect(row?.passwordHash).toBe("");
    expect(row?.inviteTokenHash).toBeTruthy();
    expect(send.messages).toHaveLength(1);
    expect(send.messages[0]?.subject).toContain("invited");
    expect(send.messages[0]?.provider).toBe("gmail");
    expect(send.messages[0]?.text).toContain("48 hours");
    expect(send.messages[0]?.text).not.toContain(row?.inviteTokenHash ?? "never");
  });

  it("refuses login until the invitation is accepted", async () => {
    await expect(
      auth.login(env, { email: "staff-one@store.test", password: "anything123" }, "127.0.0.1"),
    ).rejects.toMatchObject({ code: "invitation_pending" });
  });

  it("shows the pending access and accepts with a password", async () => {
    const send = captureSend();
    await users.invite(
      env,
      await ownerRow(),
      {
        name: "Staff Two",
        email: "staff-two@store.test",
        role: "staff",
        menuAccess: ["dashboard", "orders"],
      },
      { send: send.send },
    );
    const token = tokenFrom(send.messages[0]!.text);

    const details = await users.invitationDetails(env, token);
    expect(details).toMatchObject({
      name: "Staff Two",
      email: "staff-two@store.test",
      role: "staff",
      menuAccess: ["dashboard", "orders"],
    });

    const accepted = await users.accept(env, token, "correct horse battery");
    expect(accepted.status).toBe("active");
    expect(accepted.inviteTokenHash).toBeNull();
    expect(accepted.passwordHash).not.toBe("");
    // The same link cannot be replayed.
    await expect(users.invitationDetails(env, token)).rejects.toMatchObject({
      code: "invitation_not_found",
    });
  });

  it("accepts through the public endpoint and signs the new user in", async () => {
    const send = captureSend();
    await users.invite(
      env,
      await ownerRow(),
      {
        name: "Staff Three",
        email: "staff-three@store.test",
        role: "staff",
        menuAccess: ["dashboard", "customers"],
      },
      { send: send.send },
    );
    const token = tokenFrom(send.messages[0]!.text);

    const response = await SELF.fetch(`${ORIGIN}/api/invitations/${token}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: "correct horse battery",
        confirmPassword: "correct horse battery",
      }),
    });
    expect(response.status).toBe(200);
    const cookie = (response.headers.get("set-cookie") as string).split(";")[0]!;
    const body = (await response.json()) as { user: { status: string; email: string } };
    expect(body.user).toMatchObject({ status: "active", email: "staff-three@store.test" });

    const me = await SELF.fetch(`${ORIGIN}/api/me`, { headers: { Cookie: cookie } });
    expect(me.status).toBe(200);
    const login = await SELF.fetch(`${ORIGIN}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "staff-three@store.test",
        password: "correct horse battery",
      }),
    });
    expect(login.status).toBe(200);
  });

  it("rejects an expired invitation", async () => {
    const send = captureSend();
    await users.invite(
      env,
      await ownerRow(),
      {
        name: "Expired User",
        email: "expired@store.test",
        role: "staff",
        menuAccess: ["dashboard"],
      },
      { send: send.send },
    );
    const token = tokenFrom(send.messages[0]!.text);
    const row = await usersRepo.findUserByEmail(env, "expired@store.test");
    await usersRepo.updateUser(env, row!.id, { inviteExpiresAt: "2000-01-01 00:00:00" });
    await expect(users.invitationDetails(env, token)).rejects.toMatchObject({
      code: "invitation_expired",
      status: 410,
    });
  });

  it("searches and paginates the user list with status labels", async () => {
    const page = await users.list(env, { search: "store.test", page: 1, perPage: 30 });
    expect(page.total).toBeGreaterThanOrEqual(3);
    expect(page.users.every((row) => ["Active", "Invited", "Expired"].includes(row.statusLabel))).toBe(
      true,
    );
    const staffTwo = page.users.find((row) => row.email === "staff-two@store.test");
    expect(staffTwo?.statusLabel).toBe("Active");
    const expired = page.users.find((row) => row.email === "expired@store.test");
    expect(expired?.statusLabel).toBe("Expired");
  });

  it("keeps admin management owner-only and protects the owner row", async () => {
    const owner = await ownerRow();
    const staff = await usersRepo.findUserByEmail(env, "staff-two@store.test");
    if (!staff) throw new Error("staff missing");

    await expect(
      users.updateAccess(env, owner, ownerId, { role: "staff", menuAccess: [] }),
    ).rejects.toMatchObject({ code: "owner_protected" });

    const updated = await users.updateAccess(env, owner, staff.uuid, {
      role: "admin",
      menuAccess: ["dashboard", "users", "integrations"],
    });
    expect(updated.role).toBe("admin");
    expect(updated.menuAccess).toEqual(["dashboard", "users", "integrations"]);

    // An admin cannot touch another admin.
    const adminRow = await usersRepo.findUserById(env, staff.uuid);
    const anotherStaff = await usersRepo.findUserByEmail(env, "staff-three@store.test");
    await users.updateAccess(env, owner, anotherStaff!.uuid, {
      role: "admin",
      menuAccess: ["dashboard"],
    });
    const promoted = await usersRepo.findUserByEmail(env, "staff-three@store.test");
    await expect(
      users.updateAccess(env, adminRow!, promoted!.uuid, { role: "staff" }),
    ).rejects.toMatchObject({ code: "admin_required" });
  });

  it("rotates the link on resend and deletes the row when email fails", async () => {
    const first = captureSend();
    await users.invite(
      env,
      await ownerRow(),
      {
        name: "Resend User",
        email: "resend@store.test",
        role: "staff",
        menuAccess: ["dashboard"],
      },
      { send: first.send },
    );
    const oldToken = tokenFrom(first.messages[0]!.text);
    const row = await usersRepo.findUserByEmail(env, "resend@store.test");
    const second = captureSend();
    await users.resend(env, await ownerRow(), row!.uuid, { send: second.send });
    const newToken = tokenFrom(second.messages[0]!.text);
    expect(newToken).not.toBe(oldToken);
    await expect(users.invitationDetails(env, oldToken)).rejects.toMatchObject({
      code: "invitation_not_found",
    });
    await expect(users.invitationDetails(env, newToken)).resolves.toMatchObject({
      email: "resend@store.test",
    });

    const failed = captureSend();
    await expect(
      users.invite(
        env,
        await ownerRow(),
        {
          name: "Undelivered",
          email: "undelivered@store.test",
          role: "staff",
          menuAccess: ["dashboard"],
        },
        {
          send: async () => {
            throw new Error("mail down");
          },
        },
      ),
    ).rejects.toThrow("mail down");
    expect(await usersRepo.findUserByEmail(env, "undelivered@store.test")).toBeNull();
    void failed;
  });

  it("lists users over the admin endpoint and blocks a staff cookie", async () => {
    const listed = await SELF.fetch(`${ORIGIN}/api/users?q=staff-two`, {
      headers: { Cookie: ownerCookie },
    });
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { users: Array<{ email: string }>; total: number };
    expect(body.total).toBe(1);
    expect(body.users[0]?.email).toBe("staff-two@store.test");

    const send = captureSend();
    await users.invite(
      env,
      await ownerRow(),
      {
        name: "Staff Permission",
        email: "staff-permission@store.test",
        role: "staff",
        menuAccess: ["dashboard"],
      },
      { send: send.send },
    );
    await users.accept(env, tokenFrom(send.messages[0]!.text), "correct horse battery");

    const login = await SELF.fetch(`${ORIGIN}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "staff-permission@store.test",
        password: "correct horse battery",
      }),
    });
    expect(login.status).toBe(200);
    const staffCookie = (login.headers.get("set-cookie") as string).split(";")[0]!;
    const forbidden = await SELF.fetch(`${ORIGIN}/api/users`, {
      headers: { Cookie: staffCookie },
    });
    expect(forbidden.status).toBe(403);

    // Menu access is enforced server-side, not just hidden in the sidebar.
    expect(
      (await SELF.fetch(`${ORIGIN}/api/products`, { headers: { Cookie: staffCookie } })).status,
    ).toBe(403);
    const permissionUser = await usersRepo.findUserByEmail(
      env,
      "staff-permission@store.test",
    );
    await users.updateAccess(env, await ownerRow(), permissionUser!.uuid, {
      menuAccess: ["dashboard", "products"],
    });
    expect(
      (await SELF.fetch(`${ORIGIN}/api/products`, { headers: { Cookie: staffCookie } })).status,
    ).toBe(200);
    expect(
      (await SELF.fetch(`${ORIGIN}/api/orders`, { headers: { Cookie: staffCookie } })).status,
    ).toBe(403);
  });
});
