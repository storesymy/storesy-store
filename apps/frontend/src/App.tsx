import { Navigate, Route, Routes } from "react-router-dom";
import { CustomerDetailPage } from "./pages/CustomerDetailPage";
import { CustomersPage } from "./pages/CustomersPage";
import { HomePage } from "./pages/HomePage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
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
import { SystemPage } from "./pages/SystemPage";
import { TemplatesPage } from "./pages/TemplatesPage";

export function App() {
  return (
    <Routes>
      {/* Public storefront: what a customer sees at the origin. */}
      <Route path="/" element={<StorePage />} />
      <Route path="/sign-up" element={<SignUpPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/home" element={<HomePage />} />
      <Route path="/products" element={<ProductsPage />} />
      {/* Product detail — reached from the Manage button on /products. */}
      <Route path="/product/:uuid" element={<ProductPage />} />
      {/* Orders — what the sales pages' checkout blocks have taken. */}
      <Route path="/orders" element={<OrdersPage />} />
      {/* One order's detail — reached from the NO link on /orders. */}
      <Route path="/order/:uuid" element={<OrderDetailPage />} />
      {/* Email templates — the messages the store sends automatically. */}
      <Route path="/templates" element={<TemplatesPage />} />
      {/* Customers — buyers, deduped by email at checkout. */}
      <Route path="/customers" element={<CustomersPage />} />
      {/* One customer's detail — reached from the NO link on /customers. */}
      <Route path="/customer/:uuid" element={<CustomerDetailPage />} />
      {/* Sales Pages: list → WYSIWYG editor. */}
      <Route path="/salespages" element={<SalesPagesPage />} />
      <Route path="/salespages/:uuid" element={<SalesPageEditor />} />
      {/* Integrations — list + Add New picker; UI-only until its API exists. */}
      <Route path="/integrations" element={<IntegrationsPage />} />
      {/* `/{slug}` is deliberately NOT an SPA route: the Worker serves the
          stored standalone document there (plain HTML for crawlers), reached
          through the root Pages Function — and in dev through the middleware
          in vite.config.ts — so a page path never reaches this router. */}
      <Route path="/storefront" element={<StoreFrontPage />} />
      {/* Owner-only system tools (database viewer) — no sidebar entry, reached from the account menu. */}
      <Route path="/system" element={<SystemPage />} />
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}
