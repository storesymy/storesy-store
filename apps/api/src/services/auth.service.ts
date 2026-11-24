import type { LoginInput, SignupInput, SignupStatus, User } from "@storesy/shared";
import { forbidden, unauthorized } from "../core/errors";
import type { UserRow } from "../models/schema";
import {
  countUsers,
  findUserByEmail,
  findUserById,
  insertFirstUser,
  normalizeEmail,
} from "../models/users.repository";
import { burnVerifyTime, defaultIterations, hashPassword, verifyPassword } from "./password";
import { enforceRateLimit, resetRateLimit } from "./rate-limit.service";
import { entityUuid, ID_PREFIX } from "./uuid";

/** Account creation: hourly cap per IP. */
const SIGNUP_LIMIT = 5;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;

/** Self-signup is a one-time bootstrap; after that the store is invite-only. */
export const SIGNUP_CLOSED_MESSAGE = "Please get invites from admin";

function signupClosed() {
  return forbidden("signup_closed", SIGNUP_CLOSED_MESSAGE);
}

/** Public status for the login/sign-up pages: is the first-user slot free? */
export async function signupStatus(env: Env): Promise<SignupStatus> {
  const open = (await countUsers(env)) === 0;
  return { open, message: open ? null : SIGNUP_CLOSED_MESSAGE };
}

/** Failed+successful login attempts per email, per 15 minutes. */
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export function toPublicUser(row: UserRow): User {
  return {
    // The public id is the prefixed UUIDv7; the bigint `id` stays internal.
    id: row.uuid,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.createdAt,
  };
}

export async function signup(env: Env, input: SignupInput, clientIp: string): Promise<User> {
  // The first user is the install's owner (an admin role). Once anyone exists, self-signup
  // closes — checked before rate limiting and hashing so a closed store
  // answers immediately.
  if ((await countUsers(env)) > 0) throw signupClosed();

  await enforceRateLimit(
    env,
    `signup:${clientIp}`,
    SIGNUP_LIMIT,
    SIGNUP_WINDOW_MS,
    "Too many sign-ups from this network. Please try again later.",
  );

  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password, defaultIterations(env));
  const row = await insertFirstUser(env, {
    uuid: entityUuid(ID_PREFIX.user),
    email,
    name: input.name,
    passwordHash,
  });
  // Two first-signups raced; the other one won the admin slot.
  if (!row) throw signupClosed();
  return toPublicUser(row);
}

export async function login(env: Env, input: LoginInput, clientIp: string): Promise<User> {
  void clientIp;
  const email = normalizeEmail(input.email);
  const limiterKey = `login:${email}`;
  await enforceRateLimit(
    env,
    limiterKey,
    LOGIN_LIMIT,
    LOGIN_WINDOW_MS,
    "Too many login attempts. Please try again in a few minutes.",
  );

  const row = await findUserByEmail(env, email);
  if (!row) {
    // Spend the same CPU as a real verification so timing cannot enumerate emails.
    await burnVerifyTime(input.password);
    throw unauthorized("invalid_credentials", "Email or password is incorrect");
  }

  const valid = await verifyPassword(input.password, row.passwordHash);
  if (!valid) {
    throw unauthorized("invalid_credentials", "Email or password is incorrect");
  }

  await resetRateLimit(env, limiterKey);
  return toPublicUser(row);
}

export async function userById(env: Env, userId: string): Promise<User | null> {
  const row = await findUserById(env, userId);
  return row ? toPublicUser(row) : null;
}
