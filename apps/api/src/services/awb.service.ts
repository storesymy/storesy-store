import { courierShortLabel, formatOrderNo } from "@storesy/shared";
import type { AwbBatch, AwbGenerateResult, AwbShipmentResult } from "@storesy/shared";
import { badRequest } from "../core/errors";
import * as batchesModel from "../models/batches.repository";
import * as ordersModel from "../models/orders.repository";
import type { OrderWithPage } from "../models/orders.repository";
import type { ContactData, OrderData, OrderFulfilmentData } from "../models/schema";
import * as myParcel from "./myParcel.service";
import type { MpaAwbShipment, MpaFetch } from "./myParcel.service";
import { klNow } from "./time";
import { entityUuid } from "./uuid";

/**
 * Book labels for a merchant-selected batch. The order rows are the source of
 * truth: shipping snapshot, parcel weight/dimensions, and the customer contact.
 * A successful MPA answer is written back onto each order's shipping snapshot
 * as `trackingNo`; AWB failures never mutate the order.
 */

export interface AwbDeps {
  /** Test seam: replace the live MPA call. */
  fetchImpl?: MpaFetch;
}

interface ValidShipment {
  order: OrderWithPage;
  orderId: string;
  orderNo: string;
  shipment: MpaAwbShipment;
}

/** KL date (YYYY-MM-DD) `offset` days from today. */
function klDate(offset = 0): string {
  const shifted = new Date(Date.now() + 8 * 60 * 60 * 1000 + offset * 24 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function firstSendDate(dates: string[] | undefined): string {
  const today = klDate();
  const future = (dates ?? []).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today);
  return future[0] ?? klDate(1);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function messageStrings(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object" && "message" in entry) {
          return text((entry as { message?: unknown }).message);
        }
        return "";
      })
      .filter(Boolean);
  }
  if (value && typeof value === "object" && "message" in value) {
    return messageStrings((value as { message?: unknown }).message);
  }
  return [];
}

function trackingOf(item: Record<string, unknown>): string | null {
  for (const key of [
    "tracking_number",
    "tracking_no",
    "tracking_code",
    "awb",
    "awb_number",
    "airway_bill_no",
    "consignment_note_no",
  ]) {
    const value = text(item[key]);
    if (value) return value;
  }
  return null;
}

function awbUrlOf(item: Record<string, unknown>): string | null {
  for (const key of [
    "awb_url",
    "awb_link",
    "consignment_note_url",
    "consignment_note_link",
    "label_url",
    "pdf_url",
    "tracking_url",
  ]) {
    const value = text(item[key]);
    if (value) return value;
  }
  return null;
}

/**
 * Pull shipment results out of `data`, whatever wrapper MPA used: an array,
 * `{ shipments: [...] }` (the history shape), an id-keyed map, or a single
 * object. Only objects that look like a shipment (tracking or an order
 * reference) are kept, so envelope/meta objects never become results.
 */
function shipmentItems(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 5 || value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => shipmentItems(entry, depth + 1));
  }
  if (typeof value !== "object") return [];

  const item = value as Record<string, unknown>;
  const looksLikeShipment =
    trackingOf(item) !== null ||
    ["integration_order_id", "order_id", "reference", "shipment_key"].some(
      (key) => text(item[key]) !== "",
    );
  if (looksLikeShipment) return [item];

  return Object.values(item).flatMap((entry) => shipmentItems(entry, depth + 1));
}

function receiverOf(found: OrderWithPage): {
  name: string;
  phone: string;
  email: string;
  data: ContactData;
} {
  return {
    name: found.contact?.name || found.customer?.name || "",
    phone: found.contact?.phone || "",
    email: found.customer?.email || "",
    data: found.contact?.data ?? {},
  };
}

function buildShipment(
  found: OrderWithPage,
  credentials: myParcel.MpaCredentials,
): { shipment?: MpaAwbShipment; error?: string } {
  const data = found.order.data as OrderData;
  const shipping = data.shipping;
  if (!shipping || shipping.provider !== "myparcel-asia") {
    return { error: "This order was not priced with MyParcel Asia." };
  }
  const parcel = shipping.parcel;
  if (!parcel || !(parcel.weightKg > 0)) {
    return { error: "The order has no parcel weight; re-quote or set product weights." };
  }

  const receiver = receiverOf(found);
  const address = receiver.data.address ?? "";
  const postcode = receiver.data.postcode ?? "";
  const city = receiver.data.city ?? "";
  const state = receiver.data.state ?? "";
  const country = (receiver.data.countryCode ?? "MY").toUpperCase();
  if (!receiver.name || !receiver.phone || !receiver.email || !address || !postcode) {
    return { error: "The delivery name, phone, email, address and postcode are incomplete." };
  }
  if (!credentials.senderName || !credentials.senderPhone || !credentials.senderEmail || !credentials.senderAddress) {
    return {
      error:
        "Add the sender name, phone, email and address to the MyParcel Asia integration.",
    };
  }

  return {
    shipment: {
      integration_order_id: found.order.uuid,
      sender_postcode: credentials.senderPostcode,
      sender_name: credentials.senderName,
      sender_phone: credentials.senderPhone,
      sender_email: credentials.senderEmail,
      sender_address_line_1: credentials.senderAddress,
      receiver_country_code: country,
      receiver_postcode: postcode,
      receiver_name: receiver.name,
      receiver_phone: receiver.phone,
      receiver_email: receiver.email,
      receiver_address_line_1: address,
      ...(city ? { receiver_city: city } : {}),
      ...(state ? { receiver_state: state } : {}),
      declared_weight: parcel.weightKg,
      send_date: firstSendDate(shipping.sendDates),
      provider_code: shipping.providerCode ?? "jnt",
      // MPA rejects an empty value, so the saved Connection default is always
      // sent (dropoff when the integration predates the setting).
      send_method: credentials.defaultSendMethod,
      type: "parcel",
      size: "flyers_m",
      content_type: "general",
    },
  };
}

/**
 * Generate one batch of AWBs. Invalid orders are reported alongside the
 * successful ones; the MPA request only carries the valid shipments.
 */
export async function generate(
  env: Env,
  orderIds: string[],
  deps: AwbDeps = {},
): Promise<AwbGenerateResult> {
  const uniqueIds = [...new Set(orderIds)];
  const loaded: OrderWithPage[] = [];
  const messages: string[] = [];

  for (const id of uniqueIds) {
    const found = await ordersModel.findOrderByUuid(env, id);
    if (!found) {
      messages.push(`${id}: order not found.`);
      continue;
    }
    if (found.order.status !== "paid") {
      messages.push(`${formatOrderNo(found.order.id)}: only paid orders can be booked.`);
      continue;
    }
    // Never book the same order twice (a stale tab, or a retry after the
    // tracking write failed, must not charge the account again).
    const existingTracking = (found.order.data as OrderData).shipping?.trackingNo;
    if (existingTracking) {
      messages.push(
        `${formatOrderNo(found.order.id)}: already has tracking ${existingTracking}.`,
      );
      continue;
    }
    loaded.push(found);
  }

  if (loaded.length === 0) {
    return {
      ok: false,
      integration: "myparcel-asia",
      shipments: [],
      messages: messages.length > 0 ? messages : ["No paid orders were selected."],
    };
  }

  const firstShipping = (loaded[0]!.order.data as OrderData).shipping;
  let credentials =
    firstShipping?.integrationId !== undefined
      ? await myParcel.mpaCredentialsForIntegration(env, firstShipping.integrationId)
      : null;
  credentials ??= await myParcel.mpaCredentials(env);
  if (!credentials) {
    throw badRequest(
      "awb_not_configured",
      "Connect MyParcel Asia with a readable API key and sender details before generating AWBs.",
    );
  }

  const valid: ValidShipment[] = [];
  for (const found of loaded) {
    const built = buildShipment(found, credentials);
    if (!built.shipment) {
      messages.push(`${formatOrderNo(found.order.id)}: ${built.error ?? "not bookable."}`);
      continue;
    }
    valid.push({
      order: found,
      orderId: found.order.uuid,
      orderNo: formatOrderNo(found.order.id),
      shipment: built.shipment,
    });
  }

  if (valid.length === 0) {
    return {
      ok: false,
      integration: "myparcel-asia",
      integrationName: credentials.integrationName,
      shipments: [],
      messages,
    };
  }

  let body: unknown;
  try {
    body = await myParcel.createBulkAwb(
      env,
      credentials.integrationId,
      valid.map((entry) => entry.shipment),
      deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {},
    );
  } catch (error) {
    return {
      ok: false,
      integration: "myparcel-asia",
      integrationName: credentials.integrationName,
      shipments: [],
      messages: [
        error instanceof Error ? error.message : "MyParcel Asia rejected the AWB request.",
      ],
    };
  }

  const root = (body ?? {}) as { status?: unknown; message?: unknown; data?: unknown };
  if (root.status !== true) {
    return {
      ok: false,
      integration: "myparcel-asia",
      integrationName: credentials.integrationName,
      shipments: [],
      messages:
        messageStrings(root.message).length > 0
          ? messageStrings(root.message)
          : ["MyParcel Asia rejected the AWB request."],
    };
  }

  let items = shipmentItems(root.data);
  if (items.length === 0) {
    // Some MPA answers put the rows beside `data` instead of inside it.
    items = shipmentItems((root as { shipments?: unknown }).shipments);
  }
  const now = klNow();
  const resolved = valid.map((entry, index) => {
    const item =
      items.find((candidate) => {
        const candidateId = text(
          candidate.integration_order_id ?? candidate.order_id ?? candidate.reference,
        );
        return candidateId === entry.orderId;
      }) ??
      // Some MPA answers omit our reference but keep the request order.
      (items.length === valid.length ? items[index] : undefined) ??
      (items.length === 1 ? items[0] : undefined);
    return {
      entry,
      item,
      trackingNo: item ? trackingOf(item) : null,
      awbUrl: item ? awbUrlOf(item) : null,
    };
  });

  const booked = resolved.filter((entry) => entry.trackingNo !== null);

  let batch: AwbBatch | undefined;
  let batchRowId: number | undefined;
  if (booked.length > 0) {
    const courierLabels = [
      ...new Set(
        booked.map(({ entry }) =>
          courierShortLabel((entry.order.order.data as OrderData).shipping!.courierKey),
        ),
      ),
    ];
    const created = await batchesModel.insertBatch(env, {
      uuid: entityUuid("bat"),
      data: {
        createdAt: now,
        integrationId: credentials.integrationId,
        integrationName: credentials.integrationName,
        orderCount: booked.length,
        courierLabels,
      },
    });
    batchRowId = created.id;
    batch = {
      id: created.uuid,
      date: now,
      orderCount: booked.length,
      couriers: courierLabels,
      ...(credentials.integrationName ? { integrationName: credentials.integrationName } : {}),
    };
  }

  const results: AwbShipmentResult[] = [];
  for (const { entry, item, trackingNo, awbUrl } of resolved) {
    if (trackingNo) {
      const data = entry.order.order.data as OrderData;
      // A tracking number means the label exists — the shipment is fulfilled.
      // A delivered order is never downgraded by a late retry.
      const fulfilment: OrderFulfilmentData =
        data.fulfilment?.status === "delivered"
          ? data.fulfilment
          : {
              status: "fulfilled",
              fulfilledAt: data.fulfilment?.fulfilledAt ?? now,
              ...(data.fulfilment?.deliveredAt
                ? { deliveredAt: data.fulfilment.deliveredAt }
                : {}),
            };
      await ordersModel.updateOrder(env, entry.order.order.id, {
        data: {
          ...data,
          updatedAt: now,
          fulfilment,
          shipping: {
            ...data.shipping!,
            trackingNo,
            ...(awbUrl ? { awbUrl } : {}),
            awbGeneratedAt: now,
          },
        },
        ...(batchRowId !== undefined ? { batchId: batchRowId } : {}),
      });
    } else {
      const providerMessage = item
        ? messageStrings(item.message ?? item.error).join(" ")
        : "";
      messages.push(
        providerMessage
          ? `${entry.orderNo}: ${providerMessage}`
          : `${entry.orderNo}: AWB response had no tracking number.`,
      );
    }

    results.push({
      orderId: entry.orderId,
      orderNo: entry.orderNo,
      trackingNo,
      ...(trackingNo ? {} : { message: "Tracking number pending from MyParcel Asia." }),
    });
  }

  return {
    ok: results.length > 0 && results.every((result) => Boolean(result.trackingNo)) && messages.length === 0,
    integration: "myparcel-asia",
    integrationName: credentials.integrationName,
    ...(booked.length > 0 ? { generatedAt: now } : {}),
    ...(batch ? { batch } : {}),
    shipments: results,
    messages,
  };
}
