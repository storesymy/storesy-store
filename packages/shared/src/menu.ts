/**
 * Sidebar menu catalogue and the default access granted to each invite group.
 * The SPA builds the sidebar from this list and the invite page renders the
 * same rows, so a menu cannot appear in one place but not the other.
 */

export const MENU_KEYS = [
  "dashboard",
  "storefront",
  "salespages",
  "products",
  "orders",
  "fulfilment",
  "shipping-zone",
  "customers",
  "templates",
  "integrations",
  "users",
] as const;

export type MenuKey = (typeof MENU_KEYS)[number];

export interface MenuDefinition {
  key: MenuKey;
  label: string;
  href: string;
  /** Owner/admin only; never grantable to a staff account. */
  adminOnly?: boolean;
}

export const MENU_ITEMS: readonly MenuDefinition[] = [
  { key: "dashboard", label: "Dashboard", href: "/home" },
  { key: "storefront", label: "Store Front", href: "/storefront" },
  { key: "salespages", label: "Sales Page", href: "/salespages" },
  { key: "products", label: "Products", href: "/products" },
  { key: "orders", label: "All Orders", href: "/orders" },
  { key: "fulfilment", label: "Order to Process", href: "/fulfilment" },
  { key: "shipping-zone", label: "Shipping Zone", href: "/shipping-zone" },
  { key: "customers", label: "Customers", href: "/customers" },
  { key: "templates", label: "Email Templates", href: "/templates" },
  { key: "integrations", label: "Integrations", href: "/integrations", adminOnly: true },
  { key: "users", label: "User", href: "/users", adminOnly: true },
];

const MENU_BY_KEY = new Map(MENU_ITEMS.map((item) => [item.key, item]));

export function menuDefinition(key: MenuKey): MenuDefinition {
  return MENU_BY_KEY.get(key) as MenuDefinition;
}

export function isAdminOnlyMenu(key: MenuKey): boolean {
  return MENU_BY_KEY.get(key)?.adminOnly === true;
}

/** SPA and API share one access rule. Owner always wins. */
export function canAccessMenu(
  role: string,
  menuAccess: readonly MenuKey[],
  key: MenuKey,
): boolean {
  if (role === "owner") return true;
  if (isAdminOnlyMenu(key) && role !== "admin") return false;
  return menuAccess.includes(key);
}

/** Invite groups. Owner is the bootstrap account and is never invited. */
export type InviteRole = "admin" | "staff";

export const GROUP_DEFAULT_MENUS: Record<InviteRole, MenuKey[]> = {
  admin: MENU_ITEMS.map((item) => item.key),
  staff: [
    "dashboard",
    "storefront",
    "salespages",
    "products",
    "orders",
    "fulfilment",
    "customers",
  ],
};
