import type { SalesPageRow, ProductRow } from "../models/schema";
import * as productsModel from "../models/products.repository";
import * as salespagesModel from "../models/salespages.repository";
import { notFound, validationFailed } from "../core/errors";

/** One allowlisted checkout line, resolved against the live catalogue. */
export interface CheckoutLine {
  row: ProductRow;
  qty: number;
}

export interface ResolvedCheckout {
  pageRow: SalesPageRow;
  lines: CheckoutLine[];
}

function itemUnavailable(): never {
  throw validationFailed("Check the highlighted fields", {
    items: "One of these products is no longer available — refresh the page",
  });
}

/**
 * Shared by order creation and shipping quotes: the page must exist and be
 * open, and every ordered product must be on that page's checkout list and
 * still active. The browser's ids are only a selection; rows are the truth.
 */
export async function resolveCheckout(
  env: Env,
  slug: string,
  items: { product: string; qty: number }[],
): Promise<ResolvedCheckout> {
  const pageRow = await salespagesModel.findSalesPageBySlug(env, slug);
  if (!pageRow || pageRow.status !== "open") {
    throw notFound("page_not_found", "This page isn't taking orders right now");
  }

  const sold = new Set(pageRow.data.checkoutProducts ?? []);
  const lines: CheckoutLine[] = [];
  for (const line of items) {
    if (!sold.has(line.product)) itemUnavailable();
    const row = await productsModel.findProductByUuid(env, line.product);
    if (!row || row.data.status !== "active") itemUnavailable();
    lines.push({ row, qty: line.qty });
  }
  return { pageRow, lines };
}
