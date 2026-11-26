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

// MyParcel Asia's check_price can take ~10s on a cold upstream; the
// official WooCommerce plugin allows 45s. 20s keeps checkout responsive
// without aborting a legitimate quote.
const MPA_TIMEOUT_MS = 20_000;
const MPA_AWB_TIMEOUT_MS = 30_000;
const QUOTE_CACHE_TTL_SECONDS = 300;

export type MpaSendMethod = "dropoff" | "pickup";

/**
 * MPA accepts lowercase `dropoff`/`pickup`; the details modal stores the label
 * (`Dropoff`/`Pickup`) and older rows have nothing at all. Anything unknown
 * falls back to the connection default, Dropoff.
 */
export function normalizeMpaSendMethod(value: unknown): MpaSendMethod {
  return String(value ?? "").trim().toLowerCase() === "pickup" ? "pickup" : "dropoff";
}

export interface MpaCredentials {
  /** `integrations.id` — the account this quote came from. */
  integrationId: number;
  /** Merchant label, e.g. `LIVE Robotys` (never a secret). */
  integrationName: string;
  host: string;
  apiKey: string;
  senderPostcode: string;
  senderName?: string;
  senderPhone?: string;
  senderEmail?: string;
  senderAddress?: string;
  /** Preference saved in Connection details; already lowercase for MPA. */
  defaultSendMethod: MpaSendMethod;
}

/** One courier/service quote from `check_price`. */
export interface MpaRate {
  providerCode: string;
  providerLabel: string;
  priceCents: number;
  transitTime?: string;
  sendMethods?: string[];
  sendDates?: string[];
}

/** The chosen account + its cheapest service per provider. */
export interface MpaQuoteResult {
  integrationId: number;
  rates: Map<string, MpaRate>;
}

async function credentialsFromRow(
  env: Env,
  row: import("../models/schema").IntegrationRow,
): Promise<MpaCredentials | null> {
  const settings = row.data.settings;
  const host = (settings.host ?? "").trim().toLowerCase();
  const senderPostcode = (settings.senderPostcode ?? "").trim();
  const envelope = row.data.secrets.apiKey;
  if (!host || !envelope || !/^\d{5}$/.test(senderPostcode)) return null;
  if (!(MPA_HOSTS as readonly string[]).includes(host)) return null;

  try {
    const apiKey = await decryptSecret(env, fieldAad(row.uuid, "apiKey"), envelope);
    if (!apiKey) return null;
    return {
      integrationId: row.id,
      integrationName: row.name,
      host,
      apiKey,
      senderPostcode,
      ...(settings.senderName ? { senderName: settings.senderName } : {}),
      ...(settings.senderPhone ? { senderPhone: settings.senderPhone } : {}),
      ...(settings.senderEmail ? { senderEmail: settings.senderEmail } : {}),
      ...(settings.senderAddress ? { senderAddress: settings.senderAddress } : {}),
      defaultSendMethod: normalizeMpaSendMethod(settings.defaultSendMethod),
    };
  } catch {
    return null;
  }
}

/** The connected MPA account, or null when setup is incomplete. */
export async function mpaCredentials(env: Env): Promise<MpaCredentials | null> {
  const row = await integrationsRepo.findLatestConnectedIntegration(env, "myparcel-asia");
  return row ? credentialsFromRow(env, row) : null;
}

/** One specific MPA account — used by AWB booking so history stays on the quote's account. */
export async function mpaCredentialsForIntegration(
  env: Env,
  integrationId: number,
): Promise<MpaCredentials | null> {
  const row = await integrationsRepo.findIntegrationById(env, integrationId);
  if (!row || row.provider !== "myparcel-asia" || !row.data.connected) return null;
  return credentialsFromRow(env, row);
}

/** One shipment in the v2 bulk-AWB request. */
export type MpaAwbShipment = Record<string, unknown>;

/**
 * Book labels through MyParcel Asia's v2 bulk endpoint. The v3 host does not
 * expose this path; the response is returned raw for the caller to interpret.
 */
export async function createBulkAwb(
  env: Env,
  integrationId: number,
  shipments: MpaAwbShipment[],
  options: { fetchImpl?: MpaFetch } = {},
): Promise<unknown> {
  const credentials = await mpaCredentialsForIntegration(env, integrationId);
  if (!credentials) {
    throw new MyParcelError(
      "not_configured",
      "MyParcel Asia is missing a readable API key or sender postcode",
    );
  }

  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MPA_AWB_TIMEOUT_MS);
  let response: Response;
  try {
    response = await doFetch(`https://${credentials.host}/apiv2/create_bulk_awb`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "Storesy/1.0 (+https://storesy.my)",
      },
      body: JSON.stringify({ api_key: credentials.apiKey, shipments }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new MyParcelError(
      "request_failed",
      error instanceof Error ? error.message : "MyParcel Asia AWB request failed",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new MyParcelError("request_failed", `MyParcel Asia answered ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new MyParcelError("invalid_response", "MyParcel Asia answered with invalid JSON");
  }
}

/**
 * Download the consignment note(s) for these tracking numbers as one PDF.
 * MPA's `/apiv2/get_consignment_note` combines every tracking number in the
 * request into a single document, which is what the Print AWB tab opens.
 */
export async function getConsignmentNote(
  env: Env,
  integrationId: number | null | undefined,
  trackingNos: string[],
  options: { fetchImpl?: MpaFetch } = {},
): Promise<ArrayBuffer> {
  const unique = [...new Set(trackingNos.map((value) => value.trim()).filter(Boolean))];
  if (unique.length === 0) {
    throw new MyParcelError("invalid_response", "This batch has no tracking numbers to print");
  }

  let credentials =
    integrationId !== null && integrationId !== undefined
      ? await mpaCredentialsForIntegration(env, integrationId)
      : null;
  credentials ??= await mpaCredentials(env);
  if (!credentials) {
    throw new MyParcelError(
      "not_configured",
      "MyParcel Asia is missing a readable API key or sender postcode",
    );
  }

  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MPA_AWB_TIMEOUT_MS);
  let response: Response;
  try {
    response = await doFetch(`https://${credentials.host}/apiv2/get_consignment_note`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/pdf",
        "User-Agent": "Storesy/1.0 (+https://storesy.my)",
      },
      body: JSON.stringify({ api_key: credentials.apiKey, tracking_no: unique }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new MyParcelError(
      "request_failed",
      error instanceof Error ? error.message : "MyParcel Asia label request failed",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new MyParcelError("request_failed", `MyParcel Asia answered ${response.status}`);
  }

  const bytes = await response.arrayBuffer();
  const head = new TextDecoder().decode(new Uint8Array(bytes).slice(0, 5));
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/pdf") || head.startsWith("%PDF")) {
    return bytes;
  }

  const text = new TextDecoder().decode(new Uint8Array(bytes).slice(0, 400));
  throw new MyParcelError(
    "invalid_response",
    text
      ? `MyParcel Asia could not print these labels: ${text.replace(/\s+/g, " ").trim()}`
      : "MyParcel Asia could not print these labels",
  );
}

/** The sender identity MyParcel Asia returns for an API key. */
export interface MpaSenderProfile {
  name: string;
  phone: string;
  email: string;
  address: string;
  postcode: string;
  state: string;
}

/** MPA's Malaysian state codes → the names the merchant recognises. */
const MPA_STATE_NAMES: Record<string, string> = {
  JHR: "Johor",
  KDH: "Kedah",
  KTN: "Kelantan",
  KUL: "Kuala Lumpur",
  LBN: "Labuan",
  MLK: "Melaka",
  NSN: "Negeri Sembilan",
  PHG: "Pahang",
  PJY: "Putrajaya",
  PLS: "Perlis",
  PNG: "Pulau Pinang",
  PRK: "Perak",
  SBH: "Sabah",
  SGR: "Selangor",
  SWK: "Sarawak",
  TRG: "Terengganu",
};

function profileText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function profileMessage(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object" && "message" in entry) {
          return profileText((entry as { message?: unknown }).message);
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  if (value && typeof value === "object" && "message" in value) {
    return profileMessage((value as { message?: unknown }).message);
  }
  return "";
}

/**
 * Read the sender identity behind an API key. MyParcel Asia calls this the
 * account "me" profile; its HTTP path is `/apiv2/user`. Used when a connection
 * is saved so the merchant never types the sender details by hand.
 */
export async function fetchSenderProfile(
  host: string,
  apiKey: string,
  options: { fetchImpl?: MpaFetch } = {},
): Promise<MpaSenderProfile> {
  const normalizedHost = host.trim().toLowerCase();
  const key = apiKey.trim();
  if (!(MPA_HOSTS as readonly string[]).includes(normalizedHost)) {
    throw new MyParcelError("not_configured", "Choose a supported MyParcel Asia host");
  }
  if (!key) {
    throw new MyParcelError("not_configured", "An API Key is required");
  }

  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MPA_TIMEOUT_MS);
  let response: Response;
  try {
    response = await doFetch(`https://${normalizedHost}/apiv2/user`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "Storesy/1.0 (+https://storesy.my)",
      },
      body: JSON.stringify({ api_key: key }),
      signal: controller.signal,
    });
  } catch (error) {
    throw new MyParcelError(
      "request_failed",
      error instanceof Error ? error.message : "MyParcel Asia profile request failed",
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

  const root = (body ?? {}) as { status?: unknown; message?: unknown; data?: unknown };
  if (root.status === false) {
    const reason = profileMessage(root.message);
    throw new MyParcelError(
      "invalid_response",
      reason
        ? `MyParcel Asia rejected the API Key: ${reason}`
        : "MyParcel Asia rejected the API Key",
    );
  }

  const rawData = root.data;
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    throw new MyParcelError("invalid_response", "MyParcel Asia returned no account profile");
  }
  const data = rawData as Record<string, unknown>;

  const addressLines = [
    profileText(data.sender_address_line_1),
    profileText(data.sender_address_line_2),
    profileText(data.sender_address_line_3),
    profileText(data.sender_address_line_4),
  ]
    .map((line) => line.replace(/[,\s]+$/, ""))
    .filter(Boolean);
  const address = profileText(data.sender_address) || addressLines.join(", ");
  const name =
    profileText(data.sender_name) ||
    profileText(data.fullname) ||
    profileText(data.username);
  const phone = profileText(data.sender_phone) || profileText(data.phone);
  const email = profileText(data.sender_email) || profileText(data.email);
  const postcode = profileText(data.sender_postcode);
  const rawState =
    profileText(data.sender_state) || profileText(data.sender_state_code);
  const state = rawState ? (MPA_STATE_NAMES[rawState.toUpperCase()] ?? rawState) : "";

  if (!name || !phone || !email || !address || !/^\d{5}$/.test(postcode)) {
    throw new MyParcelError(
      "invalid_response",
      "MyParcel Asia returned incomplete sender details (name, phone, email, address and 5-digit postcode are required).",
    );
  }

  return { name, phone, email, address, postcode, state };
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
export function parseMpaRates(body: unknown): Map<string, MpaRate> {
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

  const prices = new Map<string, MpaRate>();
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
    if (current !== undefined && current.priceCents <= cents) continue;
    const methods = Array.isArray(rate.send_methods)
      ? rate.send_methods.filter((value): value is string => typeof value === "string")
      : undefined;
    const dates = Array.isArray(rate.send_dates)
      ? rate.send_dates.filter((value): value is string => typeof value === "string")
      : undefined;
    prices.set(code, {
      providerCode: code,
      providerLabel: String(rate.provider_label ?? code),
      priceCents: cents,
      ...(typeof rate.transit_time === "string" && rate.transit_time
        ? { transitTime: rate.transit_time }
        : {}),
      ...(methods && methods.length > 0 ? { sendMethods: methods } : {}),
      ...(dates && dates.length > 0 ? { sendDates: dates } : {}),
    });
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
  return `mpa:quote:v2:${credentials.integrationId}:${credentials.host}:${credentials.senderPostcode}:${receiverPostcode}:${weightKg.toFixed(2)}`;
}

async function readCache(env: Env, key: string): Promise<Map<string, MpaRate> | null> {
  try {
    const raw = await env.KV.get(key, "json");
    if (!raw || typeof raw !== "object") return null;
    const prices = new Map<string, MpaRate>();
    for (const [code, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const rate = value as Partial<MpaRate>;
      if (typeof rate.priceCents !== "number" || !Number.isFinite(rate.priceCents)) continue;
      prices.set(code, {
        providerCode: typeof rate.providerCode === "string" ? rate.providerCode : code,
        providerLabel: typeof rate.providerLabel === "string" ? rate.providerLabel : code,
        priceCents: rate.priceCents,
        ...(typeof rate.transitTime === "string" ? { transitTime: rate.transitTime } : {}),
        ...(Array.isArray(rate.sendMethods) ? { sendMethods: rate.sendMethods } : {}),
        ...(Array.isArray(rate.sendDates) ? { sendDates: rate.sendDates } : {}),
      });
    }
    return prices.size > 0 ? prices : null;
  } catch {
    return null;
  }
}

async function writeCache(env: Env, key: string, prices: Map<string, MpaRate>): Promise<void> {
  try {
    await env.KV.put(key, JSON.stringify(Object.fromEntries(prices)), {
      expirationTtl: QUOTE_CACHE_TTL_SECONDS,
    });
  } catch {
    // Cache is an optimisation; a KV failure must never fail a quote.
  }
}

/**
 * The network half: quote with explicit credentials (shared by the live
 * config lookup and the setup verifier).
 */
export async function quoteForCredentials(
  env: Env,
  credentials: MpaCredentials,
  input: { receiverPostcode: string; weightKg: number },
  options: { fetchImpl?: MpaFetch; skipCache?: boolean } = {},
): Promise<MpaQuoteResult> {
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
    if (cached) return { integrationId: credentials.integrationId, rates: cached };
  }

  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MPA_TIMEOUT_MS);
  let response: Response;
  try {
    response = await doFetch(`https://${credentials.host}/apiv3/check_price`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "Storesy/1.0 (+https://storesy.my)",
      },
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
  return { integrationId: credentials.integrationId, rates: prices };
}

/**
 * Live domestic quote using the newest connected account. Throws
 * {@link MyParcelError} with a machine-readable code; callers translate that
 * to buyer-safe copy.
 */
export async function quoteRates(
  env: Env,
  input: { receiverPostcode: string; weightKg: number },
  options: { fetchImpl?: MpaFetch; skipCache?: boolean } = {},
): Promise<MpaQuoteResult> {
  const credentials = await mpaCredentials(env);
  if (!credentials) {
    throw new MyParcelError(
      "not_configured",
      "MyParcel Asia is missing a host, API key or sender postcode",
    );
  }
  return quoteForCredentials(env, credentials, input, options);
}

export interface MyParcelVerifyResult {
  ok: boolean;
  code: string;
  message: string;
  couriers?: string[];
}

/**
 * Setup verifier for one instance: checks the stored settings, proves the
 * secret decrypts with THIS environment's key, then asks MPA for a sample
 * domestic quote. Never returns or logs the credential.
 */
export async function verifyIntegration(
  env: Env,
  uuid: string,
): Promise<MyParcelVerifyResult | null> {
  const row = await integrationsRepo.findIntegration(env, uuid);
  if (!row || row.provider !== "myparcel-asia") return null;

  const host = (row.data.settings.host ?? "").trim().toLowerCase();
  const senderPostcode = (row.data.settings.senderPostcode ?? "").trim();
  if (!host || !(MPA_HOSTS as readonly string[]).includes(host) || !/^\d{5}$/.test(senderPostcode)) {
    return {
      ok: false,
      code: "missing_settings",
      message: "Save the MyParcel Asia connection again so Storesy can load the sender profile.",
    };
  }

  const envelope = row.data.secrets.apiKey;
  if (!envelope) {
    return {
      ok: false,
      code: "missing_api_key",
      message: "No API Key is stored. Open the integration and add it.",
    };
  }

  let apiKey: string;
  try {
    apiKey = await decryptSecret(env, fieldAad(row.uuid, "apiKey"), envelope);
  } catch {
    return {
      ok: false,
      code: "credential_unreadable",
      message:
        "The stored API Key cannot be decrypted with this environment's key. Re-enter the API Key and API Secret, then save.",
    };
  }

  try {
    const result = await quoteForCredentials(
      env,
      {
        integrationId: row.id,
        integrationName: row.name,
        host,
        apiKey,
        senderPostcode,
        defaultSendMethod: normalizeMpaSendMethod(
          row.data.settings.defaultSendMethod,
        ),
      },
      { receiverPostcode: "50000", weightKg: 1 },
      { skipCache: true },
    );
    const rates = result.rates;
    return {
      ok: true,
      code: "ready",
      message: `MyParcel Asia answered with ${rates.size} courier quote${rates.size === 1 ? "" : "s"}.`,
      couriers: [...rates.keys()],
    };
  } catch (error) {
    return {
      ok: false,
      code: "provider_error",
      message: error instanceof Error ? error.message : "MyParcel Asia rejected the request.",
    };
  }
}
