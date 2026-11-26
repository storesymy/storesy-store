import type { Order } from "@storesy/shared";
import { Button, Icon, Shell } from "@storesy/ui";
import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAppNav } from "../lib/nav";
import { formatPrice } from "../lib/product";
import { relativeTime } from "../lib/salesPages";
import { useTheme } from "../lib/theme";

/**
 * All Orders — what the checkout blocks on the sales pages have taken, newest
 * first. The paid-but-unfulfilled slice lives on /fulfilment. Both views are
 * read-only lists; row actions open the order detail.
 */
export function OrdersPage() {
  const { user, loading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();
  const nav = useAppNav(location.pathname, user?.role);
  const navigate = useNavigate();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadingOrders(true);
    setLoadError(undefined);
    api
      .orders()
      .then((result) => {
        if (!cancelled) setOrders(result.orders);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // Session died mid-tab: bounce to login like a signed-out user.
        if (error instanceof ApiError && error.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setLoadError(error instanceof ApiError ? error.message : "Could not load orders.");
      })
      .finally(() => {
        if (!cancelled) setLoadingOrders(false);
      });
    return () => {
      cancelled = true;
    };
  }, [navigate, reloadKey]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } finally {
      setLoggingOut(false);
    }
  }

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  /** Semantic pill per payment status; unknown values keep the neutral chip. */
  function statusClass(status: string): string {
    return ["paid", "pending", "failed", "cancelled"].includes(status)
      ? `pd__pill pd__pill--${status}`
      : "pd__pill";
  }

  const FULFILMENT_LABEL: Record<string, string> = {
    unfulfilled: "Unfulfilled",
    fulfilled: "Fulfilled",
    delivered: "Delivered",
  };

  /** Semantic pill per fulfilment status (order detail uses the same palette). */
  function fulfilmentClass(status: string): string {
    return ["unfulfilled", "fulfilled", "delivered"].includes(status)
      ? `pd__pill pd__pill--${status}`
      : "pd__pill";
  }

  return (
    <Shell
      userName={user.name}
      userEmail={user.email}
      userRole={user.role}
      brandIcon="/storesy-icon.png"
      theme={theme}
      onThemeToggle={toggleTheme}
      onLogout={handleLogout}
      loggingOut={loggingOut}
      nav={nav}
      onNavigate={(href) => navigate(href)}
    >
      <div className="pd">
        <header className="pd__header">
          <div>
            <h1 className="pd__title">All Orders</h1>
            <p className="pd__sub">
              {loadingOrders
                ? "Loading orders…"
                : `${orders.length} ${orders.length === 1 ? "order" : "orders"} taken`}
            </p>
          </div>
          <Button variant="secondary" onClick={() => setReloadKey((key) => key + 1)}>
            Refresh
          </Button>
        </header>

        <div className="pd__panel">
          {loadError ? (
            <div className="pd__empty">
              <Icon name="layout" size={22} className="pd__emptyIcon" />
              <p className="pd__emptyTitle">Could not load orders</p>
              <p className="pd__emptyHint">{loadError}</p>
              <button
                type="button"
                className="pd__clear"
                onClick={() => setReloadKey((key) => key + 1)}
              >
                Try again
              </button>
            </div>
          ) : !loadingOrders && orders.length === 0 ? (
            <div className="pd__empty">
              <Icon name="orders" size={22} className="pd__emptyIcon" />
              <p className="pd__emptyTitle">No orders yet</p>
              <p className="pd__emptyHint">
                Orders from your sales pages' checkout blocks land here.
              </p>
            </div>
          ) : (
            <table className="pd__table" aria-label="Orders">
              <thead>
                <tr>
                  <th scope="col">NO</th>
                  <th scope="col">Page</th>
                  <th scope="col">Customer</th>
                  <th scope="col" className="pd__num">
                    Total
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">Fulfilment</th>
                  <th scope="col">Placed</th>
                  <th scope="col" className="pd__action">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr className="pd__row" key={order.id}>
                    <td>
                      <span className="pd__code">{order.orderNo}</span>
                      {order.test ? (
                        <>
                          <br />
                          <span className="pd__pill pd__pill--test pd__pill--stack">test</span>
                        </>
                      ) : null}
                    </td>
                    <td>
                      <span className="pd__name">{order.page.name}</span>
                      <br />
                      <span className="pd__code">/{order.page.slug}</span>
                    </td>
                    <td>
                      <span className="pd__name">{order.customer.name}</span>
                      <br />
                      <span className="pd__code">{order.customer.email}</span>
                    </td>
                    <td className="pd__num">{formatPrice(order.totalCents)}</td>
                    <td>
                      <span className={statusClass(order.status)}>{order.status}</span>
                    </td>
                    <td>
                      <span className={fulfilmentClass(order.fulfilment.status)}>
                        {FULFILMENT_LABEL[order.fulfilment.status] ?? order.fulfilment.status}
                      </span>
                    </td>
                    <td className="pd__updated">{relativeTime(order.createdAt)}</td>
                    <td className="pd__action">
                      <Button
                        variant="secondary"
                        className="pd__manage"
                        onClick={() => navigate(`/order/${order.id}`)}
                      >
                        Manage
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Shell>
  );
}
