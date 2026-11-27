import { Navigate, Route, Routes } from "react-router-dom";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { CustomerDetailPage } from "./pages/CustomerDetailPage";
import { CustomersPage } from "./pages/CustomersPage";
import { FulfilmentPage } from "./pages/FulfilmentPage";
import { HomePage } from "./pages/HomePage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { InviteUserPage } from "./pages/InviteUserPage";
import { LoginPage } from "./pages/LoginPage";
import { OrderDetailPage } from "./pages/OrderDetailPage";
import { OrdersPage } from "./pages/OrdersPage";
import { ProductsPage } from "./pages/ProductsPage";
import { SignUpPage } from "./pages/SignUpPage";
import { StoreFrontPage } from "./pages/StoreFrontPage";
import { StorePage } from "./pages/StorePage";
import { ProductPage } from "./pages/ProductPage";
import { SalesPageEditor } from "./pages/SalesPageEditor";
import { SalesPagesPage } from "./pages/SalesPagesPage";
import { ShippingZonePage } from "./pages/ShippingZonePage";
import { SystemPage } from "./pages/SystemPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { UsersPage } from "./pages/UsersPage";
import { RequireMenu } from "./components/RequireMenu";

export function App() {
  return (
    <Routes>
      {/* Public storefront: what a customer sees at the origin. */}
      <Route path="/" element={<StorePage />} />
      <Route path="/sign-up" element={<SignUpPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/home" element={<RequireMenu menu="dashboard"><HomePage /></RequireMenu>} />
      <Route path="/products" element={<RequireMenu menu="products"><ProductsPage /></RequireMenu>} />
      {/* Product detail — reached from the Manage button on /products. */}
      <Route path="/product/:uuid" element={<RequireMenu menu="products"><ProductPage /></RequireMenu>} />
      {/* Orders — what the sales pages' checkout blocks have taken. */}
      <Route path="/orders" element={<RequireMenu menu="orders"><OrdersPage /></RequireMenu>} />
      {/* Fulfilment — the paid-but-unfulfilled slice of the same table. */}
      <Route path="/fulfilment" element={<RequireMenu menu="fulfilment"><FulfilmentPage /></RequireMenu>} />
      {/* One order's detail — reached from the NO link on /orders. */}
      <Route path="/order/:uuid" element={<RequireMenu menu="orders"><OrderDetailPage /></RequireMenu>} />
      {/* Shipping Zone — UI-only table + create/edit dialog (no API yet). */}
      <Route path="/shipping-zone" element={<RequireMenu menu="shipping-zone"><ShippingZonePage /></RequireMenu>} />
      {/* Email templates — the messages the store sends automatically. */}
      <Route path="/templates" element={<RequireMenu menu="templates"><TemplatesPage /></RequireMenu>} />
      {/* Customers — buyers, deduped by email at checkout. */}
      <Route path="/customers" element={<RequireMenu menu="customers"><CustomersPage /></RequireMenu>} />
      {/* One customer's detail — reached from the NO link on /customers. */}
      <Route path="/customer/:uuid" element={<RequireMenu menu="customers"><CustomerDetailPage /></RequireMenu>} />
      {/* Sales Pages: list → WYSIWYG editor. */}
      <Route path="/salespages" element={<RequireMenu menu="salespages"><SalesPagesPage /></RequireMenu>} />
      <Route path="/salespages/:uuid" element={<RequireMenu menu="salespages"><SalesPageEditor /></RequireMenu>} />
      {/* Integrations — list + Add New picker; UI-only until its API exists. */}
      <Route path="/integrations" element={<RequireMenu menu="integrations"><IntegrationsPage /></RequireMenu>} />
      {/* `/{slug}` is deliberately NOT an SPA route: the Worker serves the
          stored standalone document there (plain HTML for crawlers), reached
          through the root Pages Function — and in dev through the middleware
          in vite.config.ts — so a page path never reaches this router. */}
      <Route path="/storefront" element={<RequireMenu menu="storefront"><StoreFrontPage /></RequireMenu>} />
      {/* User management — admin/owner only, mirrored by the API guard. */}
      <Route path="/users" element={<RequireMenu menu="users"><UsersPage /></RequireMenu>} />
      <Route path="/invite-user" element={<RequireMenu menu="users"><InviteUserPage /></RequireMenu>} />
      {/* Public invitation acceptance: no shell, no session required. */}
      <Route path="/invite/:token" element={<AcceptInvitePage />} />
      {/* Owner-only system tools (database viewer) — no sidebar entry, reached from the account menu. */}
      <Route path="/system" element={<SystemPage />} />
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}
