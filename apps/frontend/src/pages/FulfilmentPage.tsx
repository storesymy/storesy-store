import type { AwbBatch, AwbGenerateResult, Order } from "@storesy/shared";
import { countryByCode, routes } from "@storesy/shared";
import { Button, Icon, Shell } from "@storesy/ui";
import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { AwbModal } from "../components/AwbModal";
import { useAuth } from "../lib/auth";
import { useAppNav } from "../lib/nav";
import { useTheme } from "../lib/theme";

type FulfilmentTab = "pending" | "selected" | "batches";

/** Destination shown in the table: state for Malaysia, country elsewhere. */
function sendTo(order: Order): string {
  const code = (order.customer.country ?? "").toUpperCase();
  if (code === "MY") return order.customer.state?.trim() || "Malaysia";
  if (!code) return "—";
  return countryByCode(code)?.name ?? code;
}

function itemQty(order: Order): number {
  return (order.items ?? []).reduce((sum, item) => sum + item.qty, 0);
}

function totalKg(order: Order): string {
  const weight = order.shipping?.parcel?.weightKg;
  return typeof weight === "number" ? `${weight} kg` : "—";
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** `YYYY-MM-DD HH:MM:SS` (KL) → `26 Nov 2026, 10:27`. */
function batchDate(stamp: string): string {
  const [date, time] = stamp.split(" ");
  const [year, month, day] = (date ?? "").split("-");
  const label = MONTHS[Number(month) - 1];
  if (!year || !label || !day) return stamp || "—";
  return `${Number(day)} ${label} ${year}${time ? `, ${time.slice(0, 5)}` : ""}`;
}



/**
 * Fulfilment — the paid-but-unfulfilled slice of the orders table. Pending is
 * the work queue, Selected keeps the merchant's ticked rows together, and
 * Batches is the placeholder for the later batch-booking flow.
 */
export function FulfilmentPage() {
  const { user, loading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();
  const nav = useAppNav(location.pathname, user?.role);
  const navigate = useNavigate();

  const [orders, setOrders] = useState<Order[]>([]);
  const [batches, setBatches] = useState<AwbBatch[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<FulfilmentTab>("pending");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [awbOpen, setAwbOpen] = useState(false);
  const [awbBusy, setAwbBusy] = useState(false);
  const [awbResult, setAwbResult] = useState<AwbGenerateResult | null>(null);
  const [awbError, setAwbError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setLoadingOrders(true);
    setLoadError(undefined);
    Promise.all([api.ordersToProcess(), api.fulfilmentBatches()])
      .then(([orderResult, batchResult]) => {
        if (cancelled) return;
        setOrders(orderResult.orders);
        setBatches(batchResult.batches);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
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

  // Booked orders leave the queue and live in Batches; Selected only ever
  // carries orders that still need a label.
  const selectedOrders = orders.filter(
    (order) => selected.has(order.id) && !order.shipping?.trackingNo,
  );
  const pendingOrders = orders.filter(
    (order) => !selected.has(order.id) && !order.shipping?.trackingNo,
  );
  const unbookedCount = orders.filter((order) => !order.shipping?.trackingNo).length;
  const visibleOrders =
    tab === "pending" ? pendingOrders : tab === "selected" ? selectedOrders : [];

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } finally {
      setLoggingOut(false);
    }
  }

  function addSelected(id: string): void {
    setSelected((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  async function generateAwb(): Promise<void> {
    const orderIds = selectedOrders.map((order) => order.id);
    if (orderIds.length === 0) return;
    setAwbOpen(true);
    setAwbBusy(true);
    setAwbResult(null);
    setAwbError(undefined);
    try {
      const result = await api.generateAwb({ orderIds });
      setAwbResult(result);
      const booked = result.shipments.filter((shipment) => shipment.trackingNo);
      if (booked.length > 0) {
        const bookedIds = new Set(booked.map((shipment) => shipment.orderId));
        const generatedAt = result.generatedAt;
        setOrders((prev) =>
          prev.map((order) => {
            const shipment = booked.find((entry) => entry.orderId === order.id);
            if (!shipment?.trackingNo || !order.shipping) return order;
            return {
              ...order,
              shipping: {
                ...order.shipping,
                trackingNo: shipment.trackingNo,
                ...(generatedAt ? { awbGeneratedAt: generatedAt } : {}),
              },
              fulfilment:
                order.fulfilment.status === "delivered"
                  ? order.fulfilment
                  : {
                      status: "fulfilled",
                      fulfilledAt: order.fulfilment.fulfilledAt ?? generatedAt ?? null,
                      deliveredAt: order.fulfilment.deliveredAt,
                    },
            };
          }),
        );
        // Booked rows leave Selected and the queue; show their new batch.
        setSelected((prev) => {
          const next = new Set(prev);
          for (const id of bookedIds) next.delete(id);
          return next;
        });
        const createdBatch = result.batch;
        if (createdBatch) {
          setBatches((prev) => [
            createdBatch,
            ...prev.filter((batch) => batch.id !== createdBatch.id),
          ]);
        }
        setTab("batches");
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        navigate("/login", { replace: true });
        return;
      }
      setAwbError(
        error instanceof ApiError ? error.message : "Could not generate the AWBs.",
      );
    } finally {
      setAwbBusy(false);
    }
  }

  /** The API streams MPA's combined PDF; a tab lets the browser print it. */
  function printBatch(batch: AwbBatch): void {
    const url = `${routes.fulfilmentBatches}/${encodeURIComponent(batch.id)}/print_label`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function removeSelected(id: string): void {
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  const emptyCopy =
    tab === "selected"
      ? {
          title: "No orders selected",
          hint: "Tick orders in Pending to build a selection.",
        }
      : tab === "batches"
        ? {
            title: "No batches yet",
            hint: "Generate AWB for a selection and its batch appears here.",
          }
        : selectedOrders.length > 0
          ? {
              title: "No pending orders",
              hint: "All paid orders are now in Selected.",
            }
          : {
              title: "No orders to process",
              hint: "Paid orders waiting for fulfilment will appear here.",
            };

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
            <h1 className="pd__title">Order to Process</h1>
            <p className="pd__sub">
              {loadingOrders
                ? "Loading orders…"
                : `${unbookedCount} paid ${unbookedCount === 1 ? "order" : "orders"} to process`}
            </p>
          </div>
          <Button variant="secondary" onClick={() => setReloadKey((key) => key + 1)}>
            Refresh
          </Button>
        </header>

        <div className="fulfilment__tabs" role="group" aria-label="Fulfilment views">
          <Button
            variant={tab === "pending" ? "primary" : "secondary"}
            aria-pressed={tab === "pending"}
            onClick={() => setTab("pending")}
          >
            Pending
          </Button>
          <Button
            variant={tab === "selected" ? "primary" : "secondary"}
            aria-pressed={tab === "selected"}
            onClick={() => setTab("selected")}
          >
            Selected
            {selectedOrders.length > 0 ? (
              <span className="fulfilment__tabBadge">{selectedOrders.length}</span>
            ) : null}
          </Button>
          <Button
            variant={tab === "batches" ? "primary" : "secondary"}
            aria-pressed={tab === "batches"}
            onClick={() => setTab("batches")}
          >
            Batches
            {batches.length > 0 ? (
              <span className="fulfilment__tabBadge">{batches.length}</span>
            ) : null}
          </Button>
          {tab === "selected" ? (
            <Button
              className="fulfilment__awb"
              disabled={selectedOrders.length === 0 || awbBusy}
              onClick={() => void generateAwb()}
            >
              Generate AWB
            </Button>
          ) : null}
        </div>

        <div className="pd__panel">
          {loadError ? (
            <div className="pd__empty">
              <Icon name="orders" size={22} className="pd__emptyIcon" />
              <p className="pd__emptyTitle">Could not load orders to process</p>
              <p className="pd__emptyHint">{loadError}</p>
              <button
                type="button"
                className="pd__clear"
                onClick={() => setReloadKey((key) => key + 1)}
              >
                Try again
              </button>
            </div>
          ) : loadingOrders && orders.length === 0 ? (
            <div className="pd__empty">
              <p className="pd__emptyTitle">Loading orders…</p>
            </div>
          ) : tab === "batches" ? (
            batches.length === 0 ? (
              <div className="pd__empty">
                <Icon name="orders" size={22} className="pd__emptyIcon" />
                <p className="pd__emptyTitle">{emptyCopy.title}</p>
                <p className="pd__emptyHint">{emptyCopy.hint}</p>
              </div>
            ) : (
              <table className="pd__table" aria-label="AWB batches">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col" className="pd__num">
                      Total Order
                    </th>
                    <th scope="col">Courier</th>
                    <th scope="col" className="pd__action">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((batch) => (
                    <tr className="pd__row" key={batch.id}>
                      <td>{batchDate(batch.date)}</td>
                      <td className="pd__num">{batch.orderCount}</td>
                      <td>{batch.couriers.join(", ") || "—"}</td>
                      <td className="pd__action">
                        <Button
                          variant="secondary"
                          className="pd__manage"
                          title="Print this batch's AWB"
                          onClick={() => printBatch(batch)}
                        >
                          Print AWB
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : visibleOrders.length === 0 ? (
            <div className="pd__empty">
              <Icon name="orders" size={22} className="pd__emptyIcon" />
              <p className="pd__emptyTitle">{emptyCopy.title}</p>
              <p className="pd__emptyHint">{emptyCopy.hint}</p>
            </div>
          ) : (
            <table className="pd__table" aria-label="Orders to process">
              <thead>
                <tr>
                  <th scope="col">NO</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Send To</th>
                  <th scope="col">Courier</th>
                  <th scope="col" className="pd__num">
                    Quantity
                  </th>
                  <th scope="col" className="pd__num">
                    Total KG
                  </th>
                  <th scope="col" className="pd__action">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleOrders.map((order) => (
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
                      <span className="pd__name">{order.customer.name}</span>
                      <br />
                      <span className="pd__code">{order.customer.email}</span>
                    </td>
                    <td>{sendTo(order)}</td>
                    <td>
                      {order.shipping?.courierLabel ?? "—"}
                      {order.shipping?.trackingNo ? (
                        <>
                          <br />
                          <span className="fulfilment__tracking">
                            {order.shipping.trackingNo}
                          </span>
                        </>
                      ) : null}
                    </td>
                    <td className="pd__num">
                      {itemQty(order)} {itemQty(order) === 1 ? "item" : "items"}
                    </td>
                    <td className="pd__num">{totalKg(order)}</td>
                    <td className="pd__action">
                      {tab === "selected" ? (
                        <Button
                          variant="secondary"
                          className="pd__manage"
                          onClick={() => removeSelected(order.id)}
                        >
                          Remove
                        </Button>
                      ) : (
                        <Button
                          variant="secondary"
                          className="pd__manage"
                          onClick={() => addSelected(order.id)}
                        >
                          Add to Selected
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {awbOpen ? (
        <AwbModal
          busy={awbBusy}
          result={awbResult}
          error={awbError}
          onClose={() => setAwbOpen(false)}
        />
      ) : null}
    </Shell>
  );
}
