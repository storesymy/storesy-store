import {
  THANK_YOU_TEMPLATE_KEY,
  defaultEmailTemplate,
  formatOrderNo,
  renderEmailTemplate,
} from "@storesy/shared";
import type { OrderCustomer } from "@storesy/shared";
import type { OrderData, SalesPageData } from "../models/schema";
import * as emailTemplateService from "./emailTemplates.service";
import * as integrationsRepo from "../models/integrations.repository";
import * as ordersRepo from "../models/orders.repository";
import * as pagesRepo from "../models/salespages.repository";
import * as productsRepo from "../models/products.repository";
import * as usersRepo from "../models/users.repository";
import { sendIntegrationEmail } from "./email.service";
import type { EmailMessage } from "./email.service";
import { klNow } from "./time";

/**
 * Payment notifications — the two emails a paid order sends:
 *
 *   1. the buyer: a thank-you with what they bought, plus download links for
 *      anything digital (R2 files through the order's private link, and the
 *      merchant's own URLs);
 *   2. the store's primary admin: a "new checkout" with the customer and the
 *      money, so the merchant hears about the sale without polling Orders.
 *
 * Both go through the page's own Email integration (Cloudflare or Gmail) —
 * the same credentials Test Email uses. Every failure is logged and skipped:
 * an email problem must never undo a payment. Sent markers live on the order
 * (`data.notified`) so retries and duplicate gateway callbacks never double-
 * send. Test orders are sent too, clearly prefixed `[TEST]`.
 */

/** Subject + body — the recipient is attached at send time. */
export type EmailBody = Omit<EmailMessage, "to">;

/** One purchased product's download destinations. */
export interface DownloadEntry {
  name: string;
  urls: string[];
}

function money(cents: number): string {
  return `RM${(cents / 100).toFixed(2)}`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function itemLines(order: OrderData): string {
  return order.items
    .map((item) => `- ${item.name} × ${item.qty} — ${money(item.unitCents * item.qty)}`)
    .join("\n");
}

/** The merchant-edited subject + message a send should use. */
export interface CustomerEmailTemplate {
  subject: string;
  body: string;
}

/** Collapse the gaps empty placeholders leave behind (never the words). */
function tidy(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function customerAddress(customer: OrderCustomer): string {
  const parts = [customer.address, customer.postcode, customer.city, customer.state].filter(
    (part): part is string => typeof part === "string" && part !== "",
  );
  return parts.join(", ");
}

/**
 * The buyer's thank-you — courtesy, the receipt, then the downloads. The
 * subject and body come from the merchant-edited template (the built-in one
 * when none is supplied); placeholders are filled from the order.
 */
export function buildCustomerEmail(
  order: OrderData,
  customer: OrderCustomer,
  pageName: string,
  orderNo: string,
  downloads: DownloadEntry[],
  template: CustomerEmailTemplate = defaultEmailTemplate(THANK_YOU_TEMPLATE_KEY) as CustomerEmailTemplate,
): EmailBody {
  const prefix = order.test ? "[TEST] " : "";
  const paidAt = order.payment?.paidAt ?? order.updatedAt;
  const units = order.items.reduce((sum, item) => sum + item.qty, 0);
  const downloadLines = downloads
    .flatMap((entry) =>
      entry.urls.map((url, index) =>
        entry.urls.length > 1 ? `- ${entry.name} (${index + 1}): ${url}` : `- ${entry.name}: ${url}`,
      ),
    )
    .join("\n");

  const values: Record<string, string> = {
    firstName: firstName(customer.name),
    customerName: customer.name,
    email: customer.email,
    orderNo,
    paidAt,
    pageName,
    items: itemLines(order),
    total: money(order.totalCents),
    quantity: `${units} item${units === 1 ? "" : "s"}`,
    shippingNote:
      order.shippingCents > 0
        ? `We'll be in touch at ${customer.email} about delivery.`
        : "",
    downloads: downloadLines !== "" ? `Downloads\n${downloadLines}` : "",
    testNote: order.test ? "— Test order: no payment was taken. —" : "",
  };

  return {
    subject: `${prefix}${renderEmailTemplate(template.subject, values)}`,
    text: tidy(renderEmailTemplate(template.body, values)),
  };
}

/** The merchant's heads-up: who bought, what, and how much. */
export function buildAdminEmail(
  order: OrderData,
  customer: OrderCustomer,
  pageName: string,
  orderNo: string,
  slug: string,
): EmailBody {
  const prefix = order.test ? "[TEST] " : "";
  const units = order.items.reduce((sum, item) => sum + item.qty, 0);
  const address = customerAddress(customer);
  const paidAt = order.payment?.paidAt ?? order.updatedAt;

  return {
    subject: `${prefix}New checkout — ${money(order.totalCents)} — ${orderNo}`,
    text:
      `New checkout on ${pageName} (/${slug}).\n\n` +
      `Customer\n` +
      `Name: ${customer.name}\n` +
      `Email: ${customer.email}\n` +
      `Phone: ${customer.phone}\n` +
      (address !== "" ? `Address: ${address}\n` : "") +
      `\nItems\n${itemLines(order)}\n\n` +
      `Total: ${money(order.totalCents)}\n` +
      `Quantity: ${units} unit${units === 1 ? "" : "s"} in ${order.items.length} line${order.items.length === 1 ? "" : "s"}\n` +
      `Status: paid (${paidAt})\n` +
      `Order: ${orderNo}\n` +
      (order.test ? `\nTest order — no money was taken.\n` : ""),
  };
}

/** Download destinations for the order's digital products. */
async function downloadsFor(
  env: Env,
  order: OrderData,
  orderId: string,
  origin: string,
): Promise<DownloadEntry[]> {
  const entries: DownloadEntry[] = [];
  for (const item of order.items) {
    const row = await productsRepo.findProductByUuid(env, item.product);
    if (!row) continue; // deleted since the sale — nothing to hand over
    const urls: string[] = [];
    // R2 files: the order id is the capability; no account needed to redeem.
    row.data.downloadFiles.forEach((_file, index) => {
      urls.push(`${origin}/api/public/downloads/${orderId}/${item.product}/${index}`);
    });
    for (const link of row.data.downloadLinks) {
      if (/^https?:\/\//i.test(link)) urls.push(link);
    }
    if (urls.length > 0) entries.push({ name: item.name, urls });
  }
  return entries;
}

/**
 * Atomic "this email is mine to send" — one conditional UPDATE, so two
 * concurrent triggers can't both win. The timestamp doubles as the sent
 * marker; `release` undoes it when the provider refuses.
 */
async function claim(env: Env, orderId: string, which: "customer" | "admin", at: string): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE orders SET data = json_set(data, '$.notified.${which}', ?)
     WHERE uuid = ? AND json_extract(data, '$.notified.${which}') IS NULL`,
  )
    .bind(at, orderId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

async function release(env: Env, orderId: string, which: "customer" | "admin"): Promise<void> {
  await env.DB.prepare(
    `UPDATE orders SET data = json_remove(data, '$.notified.${which}') WHERE uuid = ?`,
  )
    .bind(orderId)
    .run();
}

type Send = typeof sendIntegrationEmail;

/**
 * Send both notifications for a paid order, once. Safe to call from every
 * success path (browser return, gateway callback, admin test): it checks the
 * order is actually paid and what has already gone out. Never throws.
 */
export async function notifyOrderPaid(
  env: Env,
  orderId: string,
  origin: string,
  deps: { send?: Send } = {},
): Promise<void> {
  const send = deps.send ?? sendIntegrationEmail;
  try {
    const found = await ordersRepo.findOrderByUuid(env, orderId);
    if (!found || found.order.status !== "paid" || !found.pageSlug) return;
    const order = found.order.data as OrderData;
    const notified = { ...(order.notified ?? {}) };
    if (notified.customer && notified.admin) return;

    const page = await pagesRepo.findSalesPageBySlug(env, found.pageSlug);
    if (!page) return;
    const pageData = page.data as SalesPageData;
    const senderId = pageData.emailSender;
    if (!senderId) {
      console.warn("notify_no_email_sender", { order: orderId, page: found.pageSlug });
      return;
    }
    const sender = await integrationsRepo.findIntegration(env, senderId);
    if (!sender) {
      console.warn("notify_sender_missing", { order: orderId, integration: senderId });
      return;
    }

    const downloads = await downloadsFor(env, order, orderId, origin);
    const pageName = page.name;
    const now = klNow();

    const orderNo = formatOrderNo(found.order.id);
    const foundCustomer = found.customer;
    if (!foundCustomer) {
      console.warn("notify_customer_missing", { order: orderId });
      return;
    }
    // Name/phone/address are the order's shipping contact; the email is the
    // customer identity.
    const contact = found.contact;
    const contactData = contact?.data ?? {};
    const customer: OrderCustomer = {
      name: contact?.name || foundCustomer.name,
      phone: contact?.phone ?? "",
      email: foundCustomer.email,
      ...(contactData.address ? { address: contactData.address } : {}),
      ...(contactData.postcode ? { postcode: contactData.postcode } : {}),
      ...(contactData.city ? { city: contactData.city } : {}),
      ...(contactData.state ? { state: contactData.state } : {}),
      ...(contactData.countryCode ? { country: contactData.countryCode } : {}),
    };
    // The merchant's edited wording; an unreadable template must not swallow
    // the receipt, so fall back to the built-in copy.
    let template: CustomerEmailTemplate | undefined;
    try {
      template = (await emailTemplateService.contentFor(env, THANK_YOU_TEMPLATE_KEY)) ?? undefined;
    } catch (error) {
      console.error("notify_template_failed", { order: orderId, error: String(error) });
    }
    const customerMessage = buildCustomerEmail(order, customer, pageName, orderNo, downloads, template);
    const adminMessage = buildAdminEmail(order, customer, pageName, orderNo, found.pageSlug);
    // The primary admin first; with none deliverable (test accounts only),
    // the store's own sending address is the truthful fallback.
    const senderAddress =
      sender.provider === "gmail"
        ? (sender.data.settings.username ?? "").trim()
        : (sender.data.settings.senderEmail ?? "").trim();
    const deliverableFallback =
      /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(senderAddress) &&
      !usersRepo.isUndeliverableDemoEmail(senderAddress);
    const adminEmail = (await usersRepo.firstAdminEmail(env)) ?? (deliverableFallback ? senderAddress : null);

    const jobs: Promise<void>[] = [];
    if (!notified.customer) {
      jobs.push(
        (async () => {
          // Claim before sending: the browser return and the gateway callback
          // can land together, and only one of them may send this email.
          if (!(await claim(env, orderId, "customer", now))) return;
          try {
            await send(env, sender, { ...customerMessage, to: customer.email });
          } catch (error) {
            console.error("notify_customer_failed", { order: orderId, error: String(error) });
            await release(env, orderId, "customer");
          }
        })(),
      );
    }
    if (!notified.admin && adminEmail) {
      jobs.push(
        (async () => {
          if (!(await claim(env, orderId, "admin", now))) return;
          try {
            await send(env, sender, { ...adminMessage, to: adminEmail });
          } catch (error) {
            console.error("notify_admin_failed", { order: orderId, error: String(error) });
            await release(env, orderId, "admin");
          }
        })(),
      );
    }
    await Promise.all(jobs);
  } catch (error) {
    // A notification failure is never a payment failure.
    console.error("notify_order_failed", { order: orderId, error: String(error) });
  }
}
