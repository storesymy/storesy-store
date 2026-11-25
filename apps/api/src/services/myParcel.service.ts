import { decryptSecret, fieldAad } from "./integrations.crypto";
import * as integrationsRepo from "../models/integrations.repository";

/**
 * MyParcel Asia rate quoting. The official WooCommerce plugin is the contract:
 * POST https://{host}/apiv3/check_price with a JSON body carrying the API key,
 * sender/receiver postcodes and declared weight. Only `api_key` is used — the
 * stored API secret is kept for compatibility but never sent.
 *
 * Quotes are domestic-only (MY → MY) and cached briefly in KV: the cart may
 * ask on every postcode change, and the order submit asks again to verify the
 * total.
 */

export type MpaFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type MpaErrorCode =
  | "not_configured"
  | "request_failed"
  | "invalid_response"
  | "no_rates";

export class MyParcelError extends Error {
  constructor(
    readonly code: MpaErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MyParcelError";
  }
}

/** Hosts the integration may target; anything else is refused (SSRF guard). */
export const MPA_HOSTS = ["app.myparcelasia.com", "demo.myparcelasia.com"] as const;

const MPA_TIMEOUT_MS = 8_000;
const QUOTE_CACHE_TTL_SECONDS = 300;

export interface MpaCredentials {
  host: string;
  apiKey: string;
  senderPostcode: string;
}

/** The connected MPA account, or null when setup is incomplete. */
export async function mpaCredentials(env: Env): Promise<MpaCredentials | null> {
  const row = await integrationsRepo.findLatestConnectedIntegration(env, "myparcel-asia");
  if (!row) return null;

  const host = (row.data.settings.host ?? "").trim().toLowerCase();
  const senderPostcode = (row.data.settings.senderPostcode ?? "").trim();
  const envelope = row.data.secrets.apiKey;
  if (!host || !envelope || !/^\d{5}$/.test(senderPostcode)) return null;
  if (!(MPA_HOSTS as readonly string[]).includes(host)) return null;

  try {
    const apiKey = await decryptSecret(env, fieldAad(row.uuid, "apiKey"), envelope);
    return apiKey ? { host, apiKey, senderPostcode } : null;
  } catch {
    return null;
  }
}

/** Provider code → our courier key. `J&T` normalises via the alias table. */
export function normalizeProviderCode(value: unknown): string {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
  if (!raw) return "";
  const aliases: Record<string, string> = {
    jnt: "jnt",
    jandt: "jnt",
    jandtexpress: "jnt",
    jntexpress: "jnt",
    jt: "jnt",
    ninjavan: "ninjavan",
    ninja: "ninjavan",
    poslaju: "poslaju",
    posmalaysia: "poslaju",
    aramex: "aramex",
    fedex: "fedex",
  };
  return aliases[raw] ?? raw;
}

function priceToCents(value: unknown): number | null {
  const amount = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

/**
 * Parse one v3 `check_price` response into provider → cheapest cents. The
 * response can arrive with rates as an array or a keyed object; both are
 * accepted. Exclusive topup accounts use `exclusive_price`.
 */
export function parseMpaRates(body: unknown): Map<string, number> {
  const root = (body ?? {}) as {
    data?: { rates?: unknown };
    topup?: unknown;
    meta?: { currency_code?: unknown };
    message?: unknown;
  };
  const currency = root.meta?.currency_code;
  if (typeof currency === "string" && currency.toUpperCase() !== "MYR") {
    throw new MyParcelError("invalid_response", "MyParcel Asia returned a non-MYR quote");
  }

  const rawRates = root.data?.rates;
  const rates = Array.isArray(rawRates)
    ? rawRates
    : rawRates && typeof rawRates === "object"
      ? Object.values(rawRates as Record<string, unknown>)
      : [];
  const exclusive = String(root.topup ?? "").toLowerCase() === "exclusive";

  const prices = new Map<string, number>();
  for (const entry of rates) {
    if (!entry || typeof entry !== "object") continue;
    const rate = entry as Record<string, unknown>;
    const code = normalizeProviderCode(rate.provider_code);
    if (!code) continue;
    const chosen = exclusive
      ? (rate.exclusive_price ?? rate.normal_price)
      : (rate.normal_price ?? rate.exclusive_price);
    const cents = priceToCents(chosen);
    if (cents === null) continue;
    const current = prices.get(code);
    if (current === undefined || cents < current) prices.set(code, cents);
  }

  if (prices.size === 0) {
    throw new MyParcelError(
      "no_rates",
      typeof root.message === "string" ? root.message : "MyParcel Asia returned no rates",
    );
  }
  return prices;
}

function cacheKey(credentials: MpaCredentials, receiverPostcode: string, weightKg: number) {
  return `mpa:quote:v1:${credentials.host}:${credentials.senderPostcode}:${receiverPostcode}:${weightKg.toFixed(2)}`;
}

async function readCache(env: Env, key: string): Promise<Map<string, number> | null> {
  try {
    const raw = await env.KV.get(key, "json");
    if (!raw || typeof raw !== "object") return null;
    const prices = new Map<string, number>();
    for (const [code, cents] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof cents === "number" && Number.isFinite(cents)) prices.set(code, cents);
    }
    return prices.size > 0 ? prices : null;
  } catch {
    return null;
  }
}

async function writeCache(env: Env, key: string, prices: Map<string, number>): Promise<void> {
  try {
    await env.KV.put(key, JSON.stringify(Object.fromEntries(prices)), {
      expirationTtl: QUOTE_CACHE_TTL_SECONDS,
    });
  } catch {
    // Cache is an optimisation; a KV failure must never fail a quote.
  }
}

/**
 * Live domestic quote for one parcel. Throws {@link MyParcelError} with a
 * machine-readable code; callers translate that to buyer-safe copy.
 */
export async function quoteRates(
  env: Env,
  input: { receiverPostcode: string; weightKg: number },
  options: { fetchImpl?: MpaFetch; skipCache?: boolean } = {},
): Promise<Map<string, number>> {
  const credentials = await mpaCredentials(env);
  if (!credentials) {
    throw new MyParcelError(
      "not_configured",
      "MyParcel Asia is missing a host, API key or sender postcode",
    );
  }

  const receiverPostcode = input.receiverPostcode.trim();
  if (!/^\d{5}$/.test(receiverPostcode)) {
    throw new MyParcelError("invalid_response", "A 5-digit destination postcode is required");
  }
  if (!Number.isFinite(input.weightKg) || input.weightKg <= 0) {
    throw new MyParcelError("invalid_response", "A positive parcel weight is required");
  }

  const key = cacheKey(credentials, receiverPostcode, input.weightKg);
  if (!options.skipCache) {
    const cached = await readCache(env, key);
    if (cached) return cached;
  }

  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MPA_TIMEOUT_MS);
  let response: Response;
  try {
    response = await doFetch(`https://${credentials.host}/apiv3/check_price`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        api_key: credentials.apiKey,
        sender_postcode: credentials.senderPostcode,
        receiver_postcode: receiverPostcode,
        declared_weight: input.weightKg,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new MyParcelError(
      "request_failed",
      error instanceof Error ? error.message : "MyParcel Asia request failed",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new MyParcelError("request_failed", `MyParcel Asia answered ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new MyParcelError("invalid_response", "MyParcel Asia answered with invalid JSON");
  }

  const prices = parseMpaRates(body);
  if (!options.skipCache) await writeCache(env, key, prices);
  return prices;
}
