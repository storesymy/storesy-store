import type { ReactNode } from "react";

export type IconName =
  // Navigation / sidebar
  | "dashboard"
  | "stores"
  | "products"
  | "orders"
  | "customers"
  | "inventories"
  | "email"
  | "menu"
  | "integrations"
  // Storefront studio
  | "cart"
  | "sales"
  | "link"
  | "code"
  | "monitor"
  | "phone"
  | "refresh"
  | "lock"
  | "bag"
  | "external"
  | "share"
  | "copy"
  | "palette"
  | "layout"
  | "image"
  | "plus"
  | "arrowUp"
  | "arrowDown"
  | "arrowLeft"
  | "close"
  | "reset"
  | "check"
  | "eye"
  | "clock"
  | "search"
  | "pencil";

/** Stroke glyphs on a 24px grid, sized for16px UI use. */
const GLYPHS: Record<IconName, ReactNode> = {
  //4-up grid
  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>
  ),
  // Storefront with awning
  stores: (
    <>
      <path d="M3.5 9 5 4.5h14L20.5 9" />
      <path d="M4.5 9v10a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V9" />
      <path d="M3.5 9a2.8 2.8 0 0 0 5.6 0 2.8 2.8 0 0 0 5.6 0 2.8 2.8 0 0 0 5.6 0" />
      <path d="M9.5 20v-5h5v5" />
    </>
  ),
  // Parcel
  products: (
    <>
      <path d="m12 2.8 8 4.4v9.6l-8 4.4-8-4.4V7.2Z" />
      <path d="m4 7.2 8 4.4 8-4.4" />
      <path d="M12 11.6V21.2" />
    </>
  ),
  // Receipt
  orders: (
    <>
      <path d="M6 3h12v18l-3-1.8-3 1.8-3-1.8L6 21Z" />
      <path d="M9.5 8.5h5" />
      <path d="M9.5 12.5h5" />
    </>
  ),
  // People
  customers: (
    <>
      <path d="M15.5 20.5v-1.6a3.9 3.9 0 0 0-3.9-3.9H7.4a3.9 3.9 0 0 0-3.9 3.9v1.6" />
      <circle cx="9.5" cy="7.6" r="3.6" />
      <path d="M16.6 4.1a3.6 3.6 0 0 1 0 7" />
      <path d="M20.5 20.5v-1.6a3.9 3.9 0 0 0-2.9-3.77" />
    </>
  ),
  // Stacked layers
  inventories: (
    <>
      <path d="m12 2.8 9 4.9-9 4.9-9-4.9Z" />
      <path d="m3 12.4 9 4.9 9-4.9" />
      <path d="m3 17 9 4.9 9-4.9" />
    </>
  ),
  // Hamburger — the mobile sidebar toggle.
  menu: (
    <>
      <path d="M3.5 6.5h17" />
      <path d="M3.5 12h17" />
      <path d="M3.5 17.5h17" />
    </>
  ),
  // Envelope
  email: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.6 7 8.4 5.6L20.4 7" />
    </>
  ),
  // Plug
  integrations: (
    <>
      <path d="M9 2.8v5.4" />
      <path d="M15 2.8v5.4" />
      <path d="M6.5 8.2h11v2.6a5.5 5.5 0 0 1-11 0Z" />
      <path d="M12 16.3v4.9" />
    </>
  ),
  // Shopping cart
  cart: (
    <>
      <path d="M2.5 3.5h2.6l2.3 11.1a1.7 1.7 0 0 0 1.7 1.4h8.3a1.7 1.7 0 0 0 1.7-1.4l1.4-7.1H6" />
      <circle cx="9.5" cy="20" r="1.6" />
      <circle cx="17.5" cy="20" r="1.6" />
    </>
  ),
  // Document (sales page)
  sales: (
    <>
      <path d="M14 2.8H6.6A1.8 1.8 0 0 0 4.8 4.6v14.8a1.8 1.8 0 0 0 1.8 1.8h10.8a1.8 1.8 0 0 0 1.8-1.8V8.2Z" />
      <path d="M14 2.8v5.4h5.2" />
      <path d="M8.4 13.2h7.2" />
      <path d="M8.4 16.6h7.2" />
    </>
  ),
  // Chain link
  link: (
    <>
      <path d="M10.6 13.4a4.2 4.2 0 0 0 6 0l2.4-2.4a4.2 4.2 0 1 0-6-6l-1.4 1.4" />
      <path d="M13.4 10.6a4.2 4.2 0 0 0-6 0L5 13a4.2 4.2 0 1 0 6 6l1.4-1.4" />
    </>
  ),
  // Angle brackets
  code: (
    <>
      <path d="m8.4 8-5 4 5 4" />
      <path d="m15.6 8 5 4-5 4" />
      <path d="m13.4 4.6-2.8 14.8" />
    </>
  ),
  // Desktop screen
  monitor: (
    <>
      <rect x="2.8" y="4" width="18.4" height="12.6" rx="2" />
      <path d="M8.5 20.6h7" />
      <path d="M12 16.6v4" />
    </>
  ),
  // Mobile handset
  phone: (
    <>
      <rect x="6.6" y="2.6" width="10.8" height="18.8" rx="2.6" />
      <path d="M10.6 18.4h2.8" />
    </>
  ),
  // Circular arrow
  refresh: (
    <>
      <path d="M20.4 12a8.4 8.4 0 1 1-2.5-6" />
      <path d="M20.4 3.6v5.6h-5.6" />
    </>
  ),
  // Padlock
  lock: (
    <>
      <rect x="4.6" y="10.4" width="14.8" height="10.2" rx="2" />
      <path d="M8.2 10.4V7.6a3.8 3.8 0 0 1 7.6 0v2.8" />
    </>
  ),
  // Shopping bag
  bag: (
    <>
      <path d="M5.4 7.6h13.2l1 13H4.4Z" />
      <path d="M9 10.2V6.6a3 3 0 0 1 6 0v3.6" />
    </>
  ),
  // Outbound arrow
  external: (
    <>
      <path d="M14 4.4h5.6V10" />
      <path d="M19.6 4.4 11 13" />
      <path d="M18.4 14v4.6a1.6 1.6 0 0 1-1.6 1.6H6a1.6 1.6 0 0 1-1.6-1.6V7.4A1.6 1.6 0 0 1 6 5.8h4.6" />
    </>
  ),
  // Node share graph
  share: (
    <>
      <circle cx="18" cy="5.6" r="2.6" />
      <circle cx="6" cy="12" r="2.6" />
      <circle cx="18" cy="18.4" r="2.6" />
      <path d="m8.4 10.8 7.2-3.9" />
      <path d="m8.4 13.2 7.2 3.9" />
    </>
  ),
  // Duplicate squares
  copy: (
    <>
      <rect x="9" y="9" width="11.6" height="11.6" rx="2" />
      <path d="M5.6 15h-.8A1.6 1.6 0 0 1 3.2 13.4V5.2A1.6 1.6 0 0 1 4.8 3.6h8.2A1.6 1.6 0 0 1 14.6 5.2V6" />
    </>
  ),
  // Painter's palette
  palette: (
    <>
      <path d="M12 3.4a8.6 8.6 0 0 0 0 17.2c1.2 0 1.9-.8 1.9-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.4-.7-.4-1.2 0-.9.8-1.7 1.7-1.7h1.6a4.4 4.4 0 0 0 4.3-4.4c0-4.1-3.9-7-8.6-7Z" />
      <circle cx="7.6" cy="11.4" r="1" />
      <circle cx="10.2" cy="7.8" r="1" />
      <circle cx="14.6" cy="7.8" r="1" />
    </>
  ),
  // Section layout
  layout: (
    <>
      <rect x="3.4" y="4" width="17.2" height="16" rx="2" />
      <path d="M3.4 9.6h17.2" />
      <path d="M9.4 9.6V20" />
    </>
  ),
  // Picture frame
  image: (
    <>
      <rect x="3.2" y="4.8" width="17.6" height="14.4" rx="2" />
      <circle cx="8.6" cy="9.8" r="1.6" />
      <path d="m4 17.6 4.6-4.6 3.4 3.4 3-3 5 5" />
    </>
  ),
  // Plus
  plus: <path d="M12 5.4v13.2M5.4 12h13.2" />,
  // Chevron up
  arrowUp: <path d="M12 19V5.4M6 11.4l6-6 6 6" />,
  // Chevron down
  arrowDown: <path d="M12 5v13.6M18 12.6l-6 6-6-6" />,
  // Chevron left (back)
  arrowLeft: <path d="M19 12H5.4M11.4 18l-6-6 6-6" />,
  // Cross
  close: <path d="M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8" />,
  // Counter-clockwise arrow
  reset: (
    <>
      <path d="M3.6 12a8.4 8.4 0 1 0 2.5-6" />
      <path d="M3.6 3.6v5.6h5.6" />
    </>
  ),
  // Tick
  check: <path d="m5 12.6 4.6 4.6L19 7.4" />,
  pencil: <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />,
  // Eye
  eye: (
    <>
      <path d="M2.6 12S6.2 5.6 12 5.6 21.4 12 21.4 12 17.8 18.4 12 18.4 2.6 12 2.6 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  // Clock (Coming Soon)
  clock: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 7.4V12l3.2 2" />
    </>
  ),
  // Magnifier
  search: (
    <>
      <circle cx="11" cy="11" r="6.8" />
      <path d="m20.4 20.4-4.7-4.7" />
    </>
  ),
};

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 16, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {GLYPHS[name]}
    </svg>
  );
}
