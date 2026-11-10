/**
 * Billplz — the payment gateway adapter for `POST /api/v3/bills`.
 *
 * Everything here is a pure transport: credentials come in, a bill or a bill
 * state comes out. No D1 row is touched and no secret is logged. The caller
 * (payments.service) owns the order, which integration it came from, and the
 * truthful amount — this module only speaks HTTP.
 *
 * Amounts are integer cents end to end, which is exactly Billplz's `amount`.
 */

/** The gateway answered, but not with a bill we can use. */
export class GatewayError extends Error {
  constructor(
    /** HTTP status from the gateway (0 when the request never landed). */
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

/** Billplz host option → API base. The catalogue stores the bare domain. */
export function billplzBase(host: string): string {
  // Billplz documents both hosts under `www.`; the bare domain redirects, and
  // following a redirect on a POST is not something to rely on.
  return host === "billplz-sandbox.com" ? "https://www.billplz-sandbox.com" : "https://www.billplz.com";
}

export interface BillplzCredentials {
  /** `billplz.com` or `billplz-sandbox.com` — the integration's Host. */
  host: string;
  /** Secret key (also the Basic-auth username, empty password). */
  apiKey: string;
  /** Collection the bill lands in. */
  collectionId: string;
}

export interface CreateBillInput {
  amountCents: number;
  email: string;
  name: string;
  mobile?: string;
  /** Shown to the buyer on the bill page. */
  description: string;
  /** Our own reference, echoed on the bill (`reference_1`). */
  reference: string;
  /** Server-to-server notification — Billplz requires it. */
  callbackUrl: string;
  /** Where the browser returns after paying (or giving up). */
  redirectUrl: string;
}

export interface CreatedBill {
  /** Billplz's bill id — the return trip's verification key. */
  id: string;
  /** The hosted payment page the buyer is redirected to. */
  url: string;
}

export interface BillState {
  paid: boolean;
  /** What Billplz says this bill is for, in cents. */
  amountCents: number;
  /** How much was actually collected, in cents. */
  paidAmountCents: number;
  /** `due`, `paid`, `deleted` … Billplz's own state word. */
  state: string;
}

/** Readable text for a status the gateway answered with. */
function failureMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "The payment gateway rejected the store's credentials";
  }
  if (status === 404) return "The payment gateway couldn't find that bill";
  if (status === 429) return "The payment gateway is busy — try again in a moment";
  if (status >= 500) return "The payment gateway is having trouble — try again in a moment";
  return "The payment gateway rejected the bill";
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body = (await response.json()) as unknown;
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function authHeader(apiKey: string): string {
  // Billplz: HTTP Basic with the secret key as username and an empty password.
  return `Basic ${btoa(`${apiKey}:`)}`;
}

/** POST /api/v3/bills — register the bill, return its id and hosted URL. */
export async function createBill(
  credentials: BillplzCredentials,
  input: CreateBillInput,
  fetchImpl: typeof fetch = fetch,
): Promise<CreatedBill> {
  const body = new URLSearchParams({
    collection_id: credentials.collectionId,
    email: input.email,
    name: input.name,
    amount: String(input.amountCents),
    description: input.description,
    callback_url: input.callbackUrl,
    redirect_url: input.redirectUrl,
    reference_1_label: "Order",
    reference_1: input.reference,
  });
  if (input.mobile) body.set("mobile", input.mobile);

  let response: Response;
  try {
    response = await fetchImpl(`${billplzBase(credentials.host)}/api/v3/bills`, {
      method: "POST",
      headers: {
        Authorization: authHeader(credentials.apiKey),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });
  } catch {
    throw new GatewayError(0, "Couldn't reach the payment gateway — try again");
  }

  if (!response.ok) throw new GatewayError(response.status, failureMessage(response.status));

  const json = await readJson(response);
  const id = typeof json.id === "string" ? json.id : "";
  const url = typeof json.url === "string" ? json.url : "";
  if (!id || !url) throw new GatewayError(response.status, "The payment gateway sent no bill link");
  return { id, url };
}

/** GET /api/v3/bills/{id} — the authoritative answer to "did this get paid?". */
export async function getBill(
  credentials: BillplzCredentials,
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<BillState> {
  let response: Response;
  try {
    response = await fetchImpl(
      `${billplzBase(credentials.host)}/api/v3/bills/${encodeURIComponent(id)}`,
      {
        headers: { Authorization: authHeader(credentials.apiKey), Accept: "application/json" },
      },
    );
  } catch {
    throw new GatewayError(0, "Couldn't reach the payment gateway — try again");
  }

  if (!response.ok) throw new GatewayError(response.status, failureMessage(response.status));

  const json = await readJson(response);
  return {
    paid: json.paid === true,
    amountCents: typeof json.amount === "number" ? json.amount : 0,
    paidAmountCents: typeof json.paid_amount === "number" ? json.paid_amount : 0,
    state: typeof json.state === "string" ? json.state : "",
  };
}
