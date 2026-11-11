/**
 * Password hashing: PBKDF2-SHA256 via the WebCrypto API (no WASM dependency).
 *
 * Workers' WebCrypto rejects PBKDF2 counts above 100,000 — it throws a
 * NotSupportedError rather than clamping. Keep the platform maximum as the
 * default and clamp any environment override so a misconfigured deployment
 * cannot break signup and login.
 */
const MIN_ITERATIONS = 10_000;
const MAX_ITERATIONS = 100_000;
const DEFAULT_ITERATIONS = MAX_ITERATIONS;
const SALT_BYTES = 16;
const KEY_BITS = 256;

export function defaultIterations(env?: Env): number {
  const raw = env?.PBKDF2_ITERATIONS;
  const parsed = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_ITERATIONS;
  return Math.min(Math.max(Math.trunc(parsed), MIN_ITERATIONS), MAX_ITERATIONS);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt as BufferSource,
      iterations,
    },
    keyMaterial,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Returns `pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>`. */
export async function hashPassword(password: string, iterations = DEFAULT_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, iterations);
  return ["pbkdf2-sha256", String(iterations), toBase64(salt), toBase64(hash)].join("$");
}

/** Constant-time verification; false for malformed stored values. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  const storedIterations = Number(parts[1]);
  if (!Number.isFinite(storedIterations) || storedIterations < 10_000) return false;

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64(parts[2] as string);
    expected = fromBase64(parts[3] as string);
  } catch {
    return false;
  }

  const actual = await derive(password, salt, storedIterations);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) {
    diff |= (actual[i] as number) ^ (expected[i] as number);
  }
  return diff === 0;
}

/**
 * A precomputed hash of an unguessable string, used to spend the same CPU when
 * the email does not exist so login timing cannot enumerate accounts.
 */
const DUMMY_HASH = "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export async function burnVerifyTime(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_HASH);
}
