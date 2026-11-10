import type { CustomerDetail, CustomerPage } from "@storesy/shared";
import { notFound } from "../core/errors";
import * as repo from "../models/customers.repository";

/**
 * The customers screen's read path: server-side search (name or email) and
 * pagination. 30 per page by default; a page past the end clamps to the last
 * one so a stale URL never shows an empty table.
 */

export const CUSTOMERS_PER_PAGE = 30;
const MAX_PER_PAGE = 100;

export interface CustomerListQuery {
  search?: string;
  page?: number;
  perPage?: number;
  sort?: "no" | "ltv";
  dir?: "asc" | "desc";
}

export async function list(env: Env, params: CustomerListQuery = {}): Promise<CustomerPage> {
  const perPage = Math.min(Math.max(params.perPage ?? CUSTOMERS_PER_PAGE, 1), MAX_PER_PAGE);
  const total = await repo.count(env, params.search);
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(Math.max(params.page ?? 1, 1), pageCount);
  // Default view: newest customer first.
  const sort = params.sort === "ltv" ? "ltv" : "no";
  const dir = params.dir === "asc" ? "asc" : "desc";
  const rows = await repo.listPage(env, { search: params.search, page, perPage, sort, dir });
  return {
    customers: rows.map((row) => repo.toDto(row.customer, row.contacts)),
    total,
    page,
    perPage,
  };
}

/** One customer with their active contacts — the /customer/<uuid> page. */
export async function get(env: Env, uuid: string): Promise<CustomerDetail> {
  const row = await repo.findByUuid(env, uuid);
  if (!row) throw notFound("customer_not_found", "No customer with that id");
  const contacts = await repo.listContacts(env, row.id);
  return {
    customer: repo.toDto(row, contacts.length),
    contacts: contacts.map(repo.contactToDto),
  };
}
