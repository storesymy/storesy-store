import type { LoginInput, SignupInput, User } from "@storesy/shared";
import { conflict, unauthorized } from "../core/errors";
import type { UserRow } from "../models/schema";
import {
  findUserByEmail,
  findUserById,
  insertUser,
  isUniqueViolation,
  normalizeEmail,
} from "../models/users.repository";
import { burnVerifyTime, defaultIterations, hashPassword, verifyPassword } from "./password";
import { enforceRateLimit, resetRateLimit } from "./rate-limit.service";
import { entityUuid, ID_PREFIX } from "./uuid";

/** Account creation: hourly cap per IP. */
const SIGNUP_LIMIT = 5;
const SIGNUP_WINDOW_MS = 60 * 60 * 1000;

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
  await enforceRateLimit(
    env,
    `signup:${clientIp}`,
    SIGNUP_LIMIT,
    SIGNUP_WINDOW_MS,
    "Too many sign-ups from this network. Please try again later.",
  );

  const email = normalizeEmail(input.email);
  const existing = await findUserByEmail(env, email);
  if (existing) {
    throw conflict("email_taken", "An account with this email already exists");
  }

  const passwordHash = await hashPassword(input.password, defaultIterations(env));
  try {
    const row = await insertUser(env, {
      uuid: entityUuid(ID_PREFIX.user),
      email,
      name: input.name,
      passwordHash,
    });
    return toPublicUser(row);
  } catch (error) {
    // Concurrent sign-up with the same email lands here instead of duplicating.
    if (isUniqueViolation(error)) {
      throw conflict("email_taken", "An account with this email already exists");
    }
    throw error;
  }
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
