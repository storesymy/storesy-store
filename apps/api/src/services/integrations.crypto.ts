import { internal } from "../core/errors";

/**
 * Credential encryption for the `integrations` table — AES-256-GCM, one
 * envelope per secret value, so a credential can be rotated or re-encrypted
 * field-by-field without touching the rest of the row.
 *
 * Envelope: `v1.<base64 iv>.<base64 ciphertext+tag>` — the `v1` prefix is the
 * key id, which is what makes rotation possible: decrypt tries the current
 * INTEGRATIONS_KEY first, then INTEGRATIONS_KEY_PREV, and the next write
 * re-encrypts under the current key.
 *
 * The AAD binds a ciphertext to its own row and field (`uuid:fieldKey`), so
 * pasting one provider's secret over another's fails authentication instead
 * of silently decrypting.
 *
 * Keys are provisioned per environment (`wrangler secret put
 * INTEGRATIONS_KEY` in production, `.dev.vars` locally) and never appear in
 * wrangler.jsonc, the repo, or any response.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const VERSION = "v1";
const IV_BYTES = 12; // GCM's recommended nonce length

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

/** The label a client may ever see for a secret: last four characters. */
export function secretHint(value: string): string {
  const trimmed = value.trim();
  return `••••${trimmed.slice(-4)}`;
}

/** AAD for one field of one row — ciphertexts are not portable across rows. */
export function fieldAad(integrationUuid: string, fieldKey: string): string {
  return `${integrationUuid}:${fieldKey}`;
}

async function parseKey(raw: string | undefined, which: string): Promise<CryptoKey> {
  if (!raw) {
    throw internal(
      which === "current"
        ? "INTEGRATIONS_KEY is not configured"
        : "INTEGRATIONS_KEY_PREV is not configured",
    );
  }
  const bytes = fromBase64(raw);
  if (bytes.length !== 32) throw internal(`${which} key must be 32 bytes of base64`);
  return crypto.subtle.importKey("raw", bytes as BufferSource, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function currentKey(env: Env): Promise<CryptoKey> {
  return parseKey(env.INTEGRATIONS_KEY, "current");
}

/** Encrypt one secret → an opaque `v1.…` envelope safe to store in JSON. */
export async function encryptSecret(env: Env, aad: string, plaintext: string): Promise<string> {
  const key = await currentKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource, additionalData: encoder.encode(aad) },
    key,
    encoder.encode(plaintext),
  );
  return `${VERSION}.${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`;
}

/**
 * Decrypt one envelope, falling back to the previous key during rotation.
 * Anything malformed or unauthentic throws — a tampered row must never
 * produce plaintext.
 */
export async function decryptSecret(env: Env, aad: string, envelope: string): Promise<string> {
  const [version, ivB64, ctB64] = envelope.split(".");
  if (version !== VERSION || !ivB64 || !ctB64) {
    throw internal("Stored credential is not a readable envelope");
  }
  const iv = fromBase64(ivB64);
  const ciphertext = fromBase64(ctB64);

  const keys: CryptoKey[] = [await currentKey(env)];
  if (env.INTEGRATIONS_KEY_PREV) keys.push(await parseKey(env.INTEGRATIONS_KEY_PREV, "previous"));

  for (const key of keys) {
    try {
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv as BufferSource, additionalData: encoder.encode(aad) },
        key,
        ciphertext as BufferSource,
      );
      return decoder.decode(plain);
    } catch {
      // try the next key (rotation) — GCM authentication failure lands here
    }
  }
  throw internal("Stored credential could not be decrypted");
}
