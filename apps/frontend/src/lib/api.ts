import type {
  ApiErrorBody,
  CreateIntegrationInput,
  CreateProductInput,
  CreateSalesPageInput,
  CustomerDetail,
  CustomerPage,
  DbConfig,
  DbDataPage,
  DbStructure,
  DbTable,
  DownloadFile,
  EmailTemplate,
  GmailOAuthPending,
  GmailOAuthStart,
  IntegrationRecord,
  LoginInput,
  Order,
  OrderFulfilmentStatus,
  Product,
  SalesPage as ApiSalesPage,
  SalesPageSummary,
  SignupInput,
  UpdateEmailTemplateInput,
  UpdateIntegrationInput,
  UpdateProductInput,
  UpdateSalesPageInput,
  User,
} from "@storesy/shared";
import { routes } from "@storesy/shared";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const body = data as ApiErrorBody | null;
    throw new ApiError(
      response.status,
      body?.error?.code ?? "unknown_error",
      body?.error?.message ?? "Request failed. Please try again.",
      body?.error?.fields,
    );
  }

  return data as T;
}

export const api = {
  signup: (input: SignupInput): Promise<User> =>
    request<User>(routes.signup, { method: "POST", body: JSON.stringify(input) }),

  login: (input: LoginInput): Promise<User> =>
    request<User>(routes.login, { method: "POST", body: JSON.stringify(input) }),

  logout: (): Promise<void> => request<void>(routes.logout, { method: "POST" }),

  me: (): Promise<{ user: User }> => request<{ user: User }>(routes.me),

  /* --------------------------- /integrations ------------------------------ */
  // Admin-only at the API; reads carry masked hints, never a secret.

  integrations: (): Promise<{ integrations: IntegrationRecord[] }> =>
    request<{ integrations: IntegrationRecord[] }>(routes.integrations),

  createIntegration: (input: CreateIntegrationInput): Promise<IntegrationRecord> =>
    request<IntegrationRecord>(routes.integrations, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateIntegration: (
    id: string,
    input: UpdateIntegrationInput,
  ): Promise<IntegrationRecord> =>
    request<IntegrationRecord>(`${routes.integrations}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  deleteIntegration: (id: string): Promise<void> =>
    request<void>(`${routes.integrations}/${encodeURIComponent(id)}`, { method: "DELETE" }),

  testIntegrationEmail: (
    id: string,
    overrides?: { recipient?: string; subject?: string; message?: string },
  ): Promise<{ sent: boolean; to: string; subject: string }> =>
    request<{ sent: boolean; to: string; subject: string }>(
      `${routes.integrations}/${encodeURIComponent(id)}/test-email`,
      { method: "POST", body: JSON.stringify(overrides ?? {}) },
    ),

  /* ------------------------- Gmail (Google OAuth) ------------------------- */
  // The browser is sent to `url`; the Worker's callback redirects back to
  // /integrations?gmail=connected with the pending pointer in a cookie.

  startGmailOAuth: (integrationUuid?: string): Promise<GmailOAuthStart> =>
    request<GmailOAuthStart>(routes.gmailOauthStart, {
      method: "POST",
      body: JSON.stringify({ integrationUuid }),
    }),

  gmailOAuthPending: (): Promise<GmailOAuthPending> =>
    request<GmailOAuthPending>(routes.gmailOauthPending),

  completeGmailOAuth: (name: string): Promise<IntegrationRecord> =>
    request<IntegrationRecord>(routes.gmailOauthComplete, {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  discardGmailOAuth: (): Promise<void> =>
    request<void>(routes.gmailOauthPending, { method: "DELETE" }),

  /* ------------------------------ /templates ------------------------------ */

  /** The automated messages the store sends — one card per template. */
  templates: (): Promise<{ templates: EmailTemplate[] }> =>
    request<{ templates: EmailTemplate[] }>(routes.templates),

  updateTemplate: (id: string, input: UpdateEmailTemplateInput): Promise<EmailTemplate> =>
    request<EmailTemplate>(`${routes.templates}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  /* ------------------------------ /products ------------------------------- */

  products: (): Promise<{ products: Product[] }> =>
    request<{ products: Product[] }>(routes.products),

  product: (id: string): Promise<Product> =>
    request<Product>(`${routes.products}/${encodeURIComponent(id)}`),

  updateProduct: (id: string, input: UpdateProductInput): Promise<Product> =>
    request<Product>(`${routes.products}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  createProduct: (input: CreateProductInput): Promise<Product> =>
    request<Product>(routes.products, { method: "POST", body: JSON.stringify(input) }),

  /**
   * POST /api/images — raw cropped blob in, stored path out. The path is what
   * gets saved on the product row; images only leave the browser on save.
   */
  uploadImage: async (id: string, blob: Blob): Promise<string> => {
    const data = await request<{ path: string }>(
      `${routes.images}?product=${encodeURIComponent(id)}`,
      {
        method: "POST",
        headers: { "Content-Type": blob.type || "image/webp" },
        body: blob,
      },
    );
    return data.path;
  },

  /**
   * POST /api/files — raw file bytes in, stored entry out. The server hashes
   * the content, so identical bytes always return the same path and never
   * store twice.
   */
  uploadFile: (id: string, file: File): Promise<DownloadFile> =>
    request<DownloadFile>(`${routes.files}?product=${encodeURIComponent(id)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name || "download"),
      },
      body: file,
    }),

  /* --------------------- /salespages (studio + public) -------------------- */

  /** List rows only — documents live in R2 and never ride the table. */
  salesPages: (): Promise<{ salesPages: SalesPageSummary[] }> =>
    request<{ salesPages: SalesPageSummary[] }>(routes.salesPages),

  /** Full editor detail: documents hydrated out of R2 by the server. */
  salesPage: (id: string): Promise<ApiSalesPage> =>
    request<ApiSalesPage>(`${routes.salesPages}/${encodeURIComponent(id)}`),

  createSalesPage: (input: CreateSalesPageInput): Promise<ApiSalesPage> =>
    request<ApiSalesPage>(routes.salesPages, { method: "POST", body: JSON.stringify(input) }),

  updateSalesPage: (id: string, input: UpdateSalesPageInput): Promise<ApiSalesPage> =>
    request<ApiSalesPage>(`${routes.salesPages}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  deleteSalesPage: (id: string): Promise<void> =>
    request<void>(`${routes.salesPages}/${encodeURIComponent(id)}`, { method: "DELETE" }),

  /* ---------------------------- /orders (merchant) -------------------------- */

  /** The merchant's order list, newest first; `page` narrows to one page. */
  customers: (
    params: {
      q?: string;
      page?: number;
      perPage?: number;
      sort?: "no" | "ltv";
      dir?: "asc" | "desc";
    } = {},
  ): Promise<CustomerPage> => {
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    search.set("page", String(params.page ?? 1));
    search.set("perPage", String(params.perPage ?? 30));
    if (params.sort) search.set("sort", params.sort);
    if (params.dir) search.set("dir", params.dir);
    return request<CustomerPage>(`${routes.customers}?${search.toString()}`);
  },

  customer: (uuid: string): Promise<CustomerDetail> =>
    request<CustomerDetail>(`${routes.customers}/${uuid}`),

  order: (uuid: string): Promise<Order> => request<Order>(`${routes.orders}/${uuid}`),

  updateOrderFulfilment: (uuid: string, status: OrderFulfilmentStatus): Promise<Order> =>
    request<Order>(`${routes.orders}/${uuid}/fulfilment`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  orders: (page?: string): Promise<{ orders: Order[] }> =>
    request<{ orders: Order[] }>(
      page ? `${routes.orders}?page=${encodeURIComponent(page)}` : routes.orders,
    ),

  /* --------------------- /system (owner-only viewer) ---------------------- */

  dbConfig: (): Promise<DbConfig> => request<DbConfig>(routes.dbConfig),

  dbTables: (): Promise<{ tables: DbTable[] }> =>
    request<{ tables: DbTable[] }>(routes.dbTables),

  dbStructure: (table: string): Promise<DbStructure> =>
    request<DbStructure>(`${routes.dbTables}/${encodeURIComponent(table)}/structure`),

  dbData: (table: string, page: number, pageSize: number): Promise<DbDataPage> =>
    request<DbDataPage>(
      `${routes.dbTables}/${encodeURIComponent(table)}/data?page=${page}&pageSize=${pageSize}`,
    ),
};
