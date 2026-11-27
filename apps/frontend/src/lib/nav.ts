import { isAdminRole, MENU_ITEMS, MENU_KEYS } from "@storesy/shared";
import type { MenuKey } from "@storesy/shared";
import type { NavItem } from "@storesy/ui";
import { useOrdersToProcess } from "./ordersBadge";

type NavUser = { role?: string; menuAccess?: MenuKey[] };

const ICONS: Record<MenuKey, NavItem["icon"]> = {
  dashboard: "dashboard",
  storefront: "stores",
  salespages: "sales",
  products: "products",
  orders: "orders",
  fulfilment: "orders",
  "shipping-zone": "truck",
  customers: "customers",
  templates: "email",
  integrations: "integrations",
  users: "customers",
};

function isActive(key: MenuKey, pathname: string): boolean {
  switch (key) {
    case "salespages":
      return pathname === "/salespages" || pathname.startsWith("/salespages/");
    case "orders":
      return pathname === "/orders" || pathname.startsWith("/order/");
    case "customers":
      return pathname === "/customers" || pathname.startsWith("/customer/");
    case "users":
      return pathname === "/users";
    default: {
      const href = MENU_ITEMS.find((item) => item.key === key)?.href ?? "";
      return pathname === href;
    }
  }
}

/**
 * Sidebar items for this account: the shared catalogue filtered by role
 * (admin-only entries) and the user's saved menu access. Owner sees all.
 */
export function buildNav(
  pathname: string,
  user?: NavUser | null,
  ordersToProcess = 0,
): NavItem[] {
  const role = user?.role;
  const access = new Set<MenuKey>(
    role === "owner" || role === undefined
      ? [...MENU_KEYS]
      : (user?.menuAccess ?? []),
  );

  return MENU_ITEMS.filter((item) => {
    if (item.adminOnly && role !== undefined && !isAdminRole(role)) return false;
    return access.has(item.key);
  }).map((item) => ({
    label: item.label,
    icon: ICONS[item.key],
    href: item.href,
    active: isActive(item.key, pathname),
    ...(item.key === "fulfilment" ? { count: ordersToProcess } : {}),
  }));
}

/** `buildNav` plus the live orders badge. */
export function useAppNav(pathname: string, user?: NavUser | null): NavItem[] {
  const { count } = useOrdersToProcess();
  return buildNav(pathname, user, count);
}

/**
 * Extra items for the account menu (under "My Profile"). Owner-only tools are
 * passed through by the page as `menuLinks={user.role === "owner" ? … : undefined}`.
 */
export const SYSTEM_MENU: Array<{ label: string; href: string }> = [
  { label: "System", href: "/system" },
];
