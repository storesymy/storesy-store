import { isAdminRole } from "@storesy/shared";
import type { NavItem } from "@storesy/ui";

/**
 * Single source for the sidebar menu, shared by every page in the shell.
 * Active state follows the current pathname so the highlight always matches the URL.
 *
 * `role` gates admin-only entries: Integrations vanishes for anyone the API
 * would answer `403` — defence in depth over the page's own redirect (the
 * API stays the hard boundary). Unknown/omitted role keeps the item: the
 * guard that matters is server-side.
 */
export function buildNav(pathname: string, role?: string): NavItem[] {
  const items: NavItem[] = [
    { label: "Dashboard", icon: "dashboard", href: "/home", active: pathname === "/home" },
    { label: "Store Front", icon: "stores", href: "/storefront", active: pathname === "/storefront" },
    {
      label: "Sales Page",
      icon: "sales",
      href: "/salespages",
      active: pathname === "/salespages" || pathname.startsWith("/salespages/"),
    },
    { label: "Products", icon: "products", href: "/products", active: pathname === "/products" },
    {
      label: "Orders",
      icon: "orders",
      href: "/orders",
      active: pathname === "/orders" || pathname.startsWith("/order/"),
    },
    {
      label: "Customers",
      icon: "customers",
      href: "/customers",
      active: pathname === "/customers" || pathname.startsWith("/customer/"),
    },
    {
      label: "Email Templates",
      icon: "email",
      href: "/templates",
      active: pathname === "/templates",
    },
  ];

  if (role !== undefined && !isAdminRole(role)) return items;

  items.push({
    label: "Integrations",
    icon: "integrations",
    href: "/integrations",
    active: pathname === "/integrations",
  });
  return items;
}

/**
 * Extra items for the account menu (under "My Profile"). Owner-only tools are
 * passed through by the page as `menuLinks={user.role === "owner" ? … : undefined}`.
 */
export const SYSTEM_MENU: Array<{ label: string; href: string }> = [
  { label: "System", href: "/system" },
];
