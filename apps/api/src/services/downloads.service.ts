import { notFound } from "../core/errors";
import type { OrderData } from "../models/schema";
import * as ordersRepo from "../models/orders.repository";
import * as productsRepo from "../models/products.repository";
import * as files from "./files.service";

/**
 * Paid-order downloads. The order id in the URL is the capability: it is an
 * unguessable UUIDv7, and the lookup additionally requires the order to be
 * paid AND to contain the product. Digital goods stay private (no public
 * browsing of the bucket) while a buyer can redeem their own purchase from
 * the email we send them, without an account.
 *
 * Every failure answers the same 404 — unknown order, unpaid order, product
 * not in the order, stale file — so a link never reveals which part failed.
 */

const DENIED = () => notFound("download_not_found", "This download link isn't valid");

export interface ResolvedDownload {
  object: R2ObjectBody;
  /** Stored original filename, header-safe. */
  name: string;
}

export async function resolve(
  env: Env,
  orderId: string,
  productId: string,
  index: number,
): Promise<ResolvedDownload> {
  const found = await ordersRepo.findOrderByUuid(env, orderId);
  if (!found || found.order.status !== "paid") throw DENIED();

  const order = found.order.data as OrderData;
  if (!order.items.some((item) => item.product === productId)) throw DENIED();

  const product = await productsRepo.findProductByUuid(env, productId);
  const file = product?.data.downloadFiles?.[index];
  if (!file) throw DENIED();

  const object = await files.getFile(env, file.path);
  if (!object) throw DENIED();

  const name = object.customMetadata?.name ?? file.name;
  return { object, name };
}
