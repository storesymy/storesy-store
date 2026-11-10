import type { CreateOrderInput, Order, OrderFulfilmentStatus, OrderItem } from "@storesy/shared";
import {
  ORDER_SHIPPING_CENTS,
  countryByCode,
  formatCustomerNo,
  formatOrderNo,
} from "@storesy/shared";
import { conflict, notFound, validationFailed } from "../core/errors";
import * as customersModel from "../models/customers.repository";
import * as ordersModel from "../models/orders.repository";
import * as productsModel from "../models/products.repository";
import * as salespagesModel from "../models/salespages.repository";
import type {
  ContactData,
  CustomerRow,
  OrderData,
  OrderEventsData,
  OrderFulfilmentData,
  OrderRow,
  ProductRow,
  SalesPageData,
} from "../models/schema";
import { formatKlDateTime, klNow } from "./time";
import { entityUuid, ID_PREFIX } from "./uuid";

/**
 * Public orders — the checkout block's write path on `/<slug>`, signed out.
 * The client's numbers are advisory: every price, shipping line and total is
 * recomputed from the merchant's own rows here, so a tampered form can never
 * set what the buyer pays (a disagreement is a 409 `price_changed`, which the
 * page's script answers by telling the buyer to review the new total).
 */

/** One product looked up for the order, with the fields the maths needs. */
interface PricedProduct {
  uuid: string;
  name: string;
  unitCents: number;
  ships: boolean;
  image: string | null;
}

function priceOf(row: ProductRow): number {
  const data = row.data;
  return data.discountPrice ?? data.price;
}

/** Unsaleable product: gone, or the merchant moved it to draft since the save. */
function itemUnavailable(): never {
  throw validationFailed("Check the highlighted fields", {
    items: "One of these products is no longer available — refresh the page",
  });
}

function shippingDetailsMissing(): never {
  throw validationFailed("Check the highlighted fields", {
    address: "We need a delivery address for items that ship",
  });
}

/**
 * POST /api/public/orders — capture one checkout. The page must exist and be
 * open, every ordered product must be on that page's checkout list (the
 * document's baked ids are the allowlist — no ordering arbitrary catalogue
 * items through someone's landing page), and totals are the server's.
 */
export async function create(env: Env, input: CreateOrderInput): Promise<Order> {
  const pageRow = await salespagesModel.findSalesPageBySlug(env, input.slug);
  // A paused or unknown page is the same dead end to a buyer — one answer.
  if (!pageRow || pageRow.status !== "open") {
    throw notFound("page_not_found", "This page isn't taking orders right now");
  }
  const pageData = pageRow.data as SalesPageData;
  const sold = new Set(pageData.checkoutProducts ?? []);

  // Resolve the cart against the catalogue: on the page's list, still active.
  const priced: PricedProduct[] = [];
  for (const line of input.items) {
    if (!sold.has(line.product)) itemUnavailable();
    const row = await productsModel.findProductByUuid(env, line.product);
    if (!row || row.data.status !== "active") itemUnavailable();
    priced.push({
      uuid: row.uuid,
      name: row.name,
      unitCents: priceOf(row),
      ships: (row.data.fulfilment ?? { shipment: true }).shipment === true,
      image: row.data.featured ?? null,
    });
  }

  // The server's arithmetic — the only numbers stored and returned.
  const items: OrderItem[] = priced.map((product, index) => ({
    product: product.uuid,
    name: product.name,
    unitCents: product.unitCents,
    qty: input.items[index]?.qty ?? 1,
    image: product.image,
  }));
  const subtotalCents = items.reduce((sum, item) => sum + item.unitCents * item.qty, 0);
  const shippingCents = priced.some((product) => product.ships) ? ORDER_SHIPPING_CENTS : 0;
  const totalCents = subtotalCents + shippingCents;

  // Anything that ships needs somewhere to ship to — the form's address
  // block is required by the document whenever shipping can apply.
  if (shippingCents > 0) {
    const customer = input.customer;
    if (!customer.address || !customer.postcode || !customer.city || !customer.state) {
      shippingDetailsMissing();
    }
    if (!customer.country || countryByCode(customer.country) === null) {
      throw validationFailed("Check the highlighted fields", {
        country: "Choose the destination country",
      });
    }
  }

  // The buyer's copy of the total disagreed with ours: the prices moved
  // between the page being built and this order landing. Nothing is stored.
  if (totalCents !== input.totalCents) {
    throw conflict(
      "price_changed",
      "These prices just changed — review the new total and place the order again",
    );
  }

  const now = klNow();
  // Visit/add-to-cart beats from the browser (sanitised: parseable and recent).
  const visitedAt = clientTime(input.events?.visitedAt);
  const addedAt = clientTime(input.events?.addedAt);
  const events: OrderEventsData = {
    ...(visitedAt ? { visitedAt } : {}),
    ...(addedAt ? { addedAt } : {}),
  };
  // One customer per email; one contact profile per distinct detail set. The
  // order points at both, so its shipping record is exactly what was submitted.
  const country = countryByCode(input.customer.country);
  const details = {
    name: input.customer.name,
    phone: input.customer.phone,
    email: input.customer.email,
    ...(input.customer.address ? { address: input.customer.address } : {}),
    ...(input.customer.postcode ? { postcode: input.customer.postcode } : {}),
    ...(input.customer.city ? { city: input.customer.city } : {}),
    ...(input.customer.state ? { state: input.customer.state } : {}),
    ...(country ? { countryCode: country.code, countryName: country.name } : {}),
  };
  const customer = await customersModel.upsertCustomer(env, details);
  const contact = await customersModel.findOrCreateContact(env, customer.id, details);
  // Nothing ships → nothing to fulfil: digital orders are fulfilled on
  // creation (the merchant can only move them on to delivered).
  const digitalOnly = shippingCents === 0;
  const data: OrderData = {
    items,
    subtotalCents,
    shippingCents,
    totalCents,
    createdAt: now,
    updatedAt: now,
    ...(digitalOnly ? { fulfilment: { status: "fulfilled", fulfilledAt: now } } : {}),
    ...(events.visitedAt || events.addedAt ? { events } : {}),
  };
  const row = await ordersModel.insertOrder(env, {
    uuid: entityUuid(ID_PREFIX.order),
    salesPageId: pageRow.id,
    customerId: customer.id,
    customerContactId: contact.id,
    status: "pending",
    data,
  });
  return toPublic(row, pageRow.name, pageRow.slug, customer, contact);
}

/** A browser-reported ISO time → KL date-time, or undefined when implausible. */
function clientTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const at = new Date(value);
  if (!Number.isFinite(at.getTime())) return undefined;
  const now = Date.now();
  if (at.getTime() > now + 5 * 60 * 1000) return undefined; // clock skew
  if (now - at.getTime() > 31 * 24 * 60 * 60 * 1000) return undefined; // stale tab
  return formatKlDateTime(at);
}

/** The buyer as the order API exposes them — contact first, email identity after. */
function publicCustomer(
  customer: CustomerRow | null,
  contact: { name: string; phone: string; data: ContactData } | null,
): Order["customer"] {
  const data = contact?.data ?? {};
  return {
    name: contact?.name || customer?.name || "Deleted customer",
    phone: contact?.phone ?? "",
    email: customer?.email ?? "",
    ...(data.address ? { address: data.address } : {}),
    ...(data.postcode ? { postcode: data.postcode } : {}),
    ...(data.city ? { city: data.city } : {}),
    ...(data.state ? { state: data.state } : {}),
    ...(data.countryCode ? { country: data.countryCode } : {}),
  };
}

/** Public order shape: id/status/totals out of the row, page and buyer attached. */
export function toPublic(
  row: OrderRow,
  pageName: string | null,
  pageSlug: string | null,
  customer: CustomerRow | null,
  contact: { name: string; phone: string; data: ContactData } | null,
): Order {
  const data = row.data as OrderData;
  return {
    id: row.uuid,
    orderNo: formatOrderNo(row.id),
    customerNo: customer ? formatCustomerNo(customer.id) : null,
    customerId: customer?.uuid ?? null,
    page: { name: pageName ?? "Deleted page", slug: pageSlug ?? "" },
    status: row.status,
    test: data.test === true,
    items: data.items,
    customer: publicCustomer(customer, contact),
    subtotalCents: data.subtotalCents,
    shippingCents: data.shippingCents,
    totalCents: data.totalCents,
    paidAt: data.payment?.paidAt ?? (row.status === "paid" ? data.updatedAt : null),
    payment: data.payment
      ? {
          provider: data.payment.provider,
          reference: data.payment.reference,
          url: data.payment.url,
        }
      : null,
    fulfilment: {
      status: data.fulfilment?.status ?? "unfulfilled",
      fulfilledAt: data.fulfilment?.fulfilledAt ?? null,
      deliveredAt: data.fulfilment?.deliveredAt ?? null,
    },
    events: {
      visitedAt: data.events?.visitedAt ?? null,
      addedAt: data.events?.addedAt ?? null,
    },
    customerOrders: customer?.totalCheckout ?? 0,
    customerLtvCents: customer?.ltvCents ?? 0,
    createdAt: data.createdAt,
  };
}

/** One order for the detail page. */
export async function get(env: Env, uuid: string): Promise<Order> {
  const found = await ordersModel.findOrderByUuid(env, uuid);
  if (!found) throw notFound("order_not_found", "No order with that id");
  const order = toPublic(found.order, found.pageName, found.pageSlug, found.customer, found.contact);

  // Orders placed before images were snapshotted resolve them from the
  // product (a deleted product keeps the gradient placeholder).
  const items = await Promise.all(
    order.items.map(async (item) => {
      if (item.image) return item;
      const product = await productsModel.findProductByUuid(env, item.product);
      const image = product?.data.featured ?? null;
      return image ? { ...item, image } : item;
    }),
  );
  return { ...order, items };
}

/**
 * Move the order's shipping progress. Timestamps are stamped on the transition
 * and cleared when stepping back: delivered → fulfilled keeps `fulfilledAt`,
 * fulfilled → unfulfilled clears both.
 */
export async function setFulfilment(
  env: Env,
  uuid: string,
  status: OrderFulfilmentStatus,
): Promise<Order> {
  const found = await ordersModel.findOrderByUuid(env, uuid);
  if (!found) throw notFound("order_not_found", "No order with that id");

  const data = found.order.data as OrderData;
  if (data.shippingCents === 0 && status === "unfulfilled") {
    throw validationFailed("Check the highlighted fields", {
      status: "Digital orders are fulfilled automatically.",
    });
  }
  const now = klNow();
  const previous = data.fulfilment;
  const fulfilment: OrderFulfilmentData = { status };
  if (status !== "unfulfilled") {
    fulfilment.fulfilledAt = previous?.fulfilledAt ?? now;
    if (status === "delivered") fulfilment.deliveredAt = previous?.deliveredAt ?? now;
  }

  const row = await ordersModel.updateOrder(env, found.order.id, {
    data: { ...data, fulfilment, updatedAt: now },
  });
  return toPublic(row, found.pageName, found.pageSlug, found.customer, found.contact);
}

/**
 * GET /api/orders — the merchant's list, newest first, optionally narrowed
 * to one page by its `spg-…` uuid (which must exist).
 */
export async function list(env: Env, pageUuid?: string): Promise<Order[]> {
  let pageId: number | undefined;
  if (pageUuid !== undefined) {
    const row = await salespagesModel.findSalesPageByUuid(env, pageUuid);
    if (!row) throw notFound("salespage_not_found", "No page with that id");
    pageId = row.id;
  }
  const rows = await ordersModel.listOrders(env, pageId);
  return rows.map((entry) =>
    toPublic(entry.order, entry.pageName, entry.pageSlug, entry.customer, entry.contact),
  );
}
