import {
  SHIPPING_COURIER_OPTIONS,
  SHIPPING_PRICE_TYPE_OPTIONS,
  SHIPPING_ZONE_OPTIONS,
  SHIPPING_ZONE_STATUS_OPTIONS,
  courierLabel,
  shippingPriceTypeLabel,
  shippingZoneLabel,
  shippingZoneStatusLabel,
} from "@storesy/shared";
import type {
  ShippingCourierKey,
  ShippingPriceType,
  ShippingZone,
  ShippingZoneStatus,
} from "@storesy/shared";
import { Button, Icon, SelectField, Shell, TextField } from "@storesy/ui";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { buildNav } from "../lib/nav";
import { formatPrice, priceToCents } from "../lib/product";
import { useTheme } from "../lib/theme";

interface ZoneForm {
  zoneKey: string;
  courierKey: ShippingCourierKey;
  priceType: ShippingPriceType;
  priceAmount: string;
  status: ShippingZoneStatus;
}

const EMPTY_FORM: ZoneForm = {
  zoneKey: "my-all",
  courierKey: "jnt",
  priceType: "flat",
  priceAmount: "",
  status: "active",
};

function priceHint(priceType: ShippingPriceType): string {
  if (priceType === "api") {
    return "The shipping API supplies the rate at checkout; no amount is stored.";
  }
  if (priceType === "markup") {
    return "The API rate plus this amount is charged at checkout.";
  }
  return "A fixed rate charged for every order in this zone.";
}

/**
 * Shipping Zone — delivery pricing by zone and courier. Rows come from
 * `/api/shipping-zones`; zone/courier keys are turned into labels from the
 * shared catalogue.
 */
export function ShippingZonePage() {
  const { user, loading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const [zones, setZones] = useState<ShippingZone[]>([]);
  const [loadingZones, setLoadingZones] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ZoneForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<{
    zoneKey?: string;
    courierKey?: string;
    priceAmount?: string;
  }>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingZones(true);
    setLoadError(undefined);
    api
      .shippingZones()
      .then(({ shippingZones: rows }) => {
        if (!cancelled) setZones(rows);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setLoadError(
          error instanceof Error ? error.message : "Could not load shipping zones.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingZones(false);
      });
    return () => {
      cancelled = true;
    };
  }, [navigate, reloadKey]);

  useEffect(() => {
    if (!modalOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeModal();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [modalOpen]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } finally {
      setLoggingOut(false);
    }
  }

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setFormError(undefined);
    setModalOpen(true);
  }

  function openEdit(zone: ShippingZone) {
    setEditingId(zone.id);
    setForm({
      zoneKey: zone.zoneKey,
      courierKey: zone.courierKey,
      priceType: zone.priceType,
      priceAmount: zone.priceCents === null ? "" : (zone.priceCents / 100).toFixed(2),
      status: zone.status,
    });
    setErrors({});
    setFormError(undefined);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingId(null);
    setErrors({});
    setFormError(undefined);
  }

  function handlePriceTypeChange(value: string) {
    const priceType = value as ShippingPriceType;
    setForm((prev) => ({
      ...prev,
      priceType,
      priceAmount: priceType === "api" ? "" : prev.priceAmount,
    }));
    if (errors.priceAmount) setErrors((prev) => ({ ...prev, priceAmount: undefined }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors: typeof errors = {};
    let priceCents: number | null = null;
    if (form.priceType === "api") {
      priceCents = null;
    } else {
      priceCents = priceToCents(form.priceAmount);
      if (priceCents === null) {
        nextErrors.priceAmount = "Enter a valid amount, e.g. 8.00.";
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setSaving(true);
    setFormError(undefined);
    try {
      const input = {
        zoneKey: form.zoneKey,
        courierKey: form.courierKey,
        priceType: form.priceType,
        priceCents,
        status: form.status,
      };
      if (editingId === null) {
        const created = await api.createShippingZone(input);
        setZones((prev) => [created, ...prev]);
      } else {
        const updated = await api.updateShippingZone(editingId, input);
        setZones((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
      }
      closeModal();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        navigate("/login", { replace: true });
        return;
      }
      if (error instanceof ApiError && error.fields) {
        setErrors({
          zoneKey: error.fields.zoneKey,
          courierKey: error.fields.courierKey,
          priceAmount: error.fields.priceCents ?? error.fields.priceAmount,
        });
      }
      setFormError(
        error instanceof ApiError
          ? error.message
          : "Could not save the shipping zone. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(zone: ShippingZone) {
    setDeletingId(zone.id);
    setActionError(undefined);
    try {
      await api.deleteShippingZone(zone.id);
      setZones((prev) => prev.filter((row) => row.id !== zone.id));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        navigate("/login", { replace: true });
        return;
      }
      setActionError(
        error instanceof ApiError ? error.message : "Could not delete the shipping zone.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  if (loading || loadingZones) {
    return (
      <div className="page-loading" role="status">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

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
      nav={buildNav(location.pathname, user.role)}
      onNavigate={(href) => navigate(href)}
    >
      <div className="pd">
        <header className="pd__header">
          <div>
            <h1 className="pd__title">Shipping Zone</h1>
            <p className="pd__sub">
              {zones.length} {zones.length === 1 ? "zone" : "zones"} · delivery pricing by zone
            </p>
          </div>
          <Button onClick={openCreate}>New Zone</Button>
        </header>

        {actionError ? (
          <p className="pd-modal__error" role="alert">
            {actionError}
          </p>
        ) : null}

        <div className="pd__panel">
          {loadError ? (
            <div className="pd__empty">
              <Icon name="truck" size={22} className="pd__emptyIcon" />
              <p className="pd__emptyTitle">Could not load shipping zones</p>
              <p className="pd__emptyHint">{loadError}</p>
              <button
                type="button"
                className="pd__clear"
                onClick={() => setReloadKey((key) => key + 1)}
              >
                Try again
              </button>
            </div>
          ) : (
            <table className="pd__table sz__table" aria-label="Shipping zones">
              <thead>
                <tr>
                  <th scope="col">Zone</th>
                  <th scope="col">Courier</th>
                  <th scope="col">Price Type</th>
                  <th scope="col" className="pd__num">
                    Price Amount
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col" className="pd__action">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {zones.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="sz__empty">
                        <Icon name="truck" size={22} className="pd__emptyIcon" />
                        <p className="pd__emptyTitle">No shipping zones yet</p>
                        <p className="pd__emptyHint">
                          Create a zone to set delivery pricing by zone.
                        </p>
                        <Button onClick={openCreate}>New Zone</Button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  zones.map((zone) => (
                    <tr className="pd__row" key={zone.id}>
                      <td>{shippingZoneLabel(zone.zoneKey)}</td>
                      <td>{courierLabel(zone.courierKey)}</td>
                      <td>{shippingPriceTypeLabel(zone.priceType)}</td>
                      <td className="pd__num">
                        {zone.priceType === "api" || zone.priceCents === null
                          ? "—"
                          : formatPrice(zone.priceCents)}
                      </td>
                      <td>
                        <span
                          className={
                            zone.status === "active" ? "pd__pill pd__pill--live" : "pd__pill"
                          }
                        >
                          {shippingZoneStatusLabel(zone.status)}
                        </span>
                      </td>
                      <td className="pd__action">
                        <div className="sz__actions">
                          <Button
                            variant="secondary"
                            onClick={() => openEdit(zone)}
                            disabled={deletingId !== null}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() => handleDelete(zone)}
                            loading={deletingId === zone.id}
                            disabled={deletingId !== null && deletingId !== zone.id}
                          >
                            Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {modalOpen ? (
        <div className="pd-modal" role="presentation" onClick={closeModal}>
          <div
            className="pd-modal__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sz-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="pd-modal__head">
              <h2 id="sz-modal-title">{editingId === null ? "New Zone" : "Edit Zone"}</h2>
              <button
                type="button"
                className="pd-modal__close"
                aria-label="Close"
                onClick={closeModal}
              >
                <Icon name="close" size={15} />
              </button>
            </header>

            <form className="pd-modal__body" onSubmit={handleSubmit} noValidate>
              <SelectField
                label="Zone"
                name="sz-zone"
                value={form.zoneKey}
                options={SHIPPING_ZONE_OPTIONS}
                onValueChange={(value) => {
                  setForm((prev) => ({ ...prev, zoneKey: value }));
                  if (errors.zoneKey) setErrors((prev) => ({ ...prev, zoneKey: undefined }));
                }}
                error={errors.zoneKey}
              />

              <SelectField
                label="Courier"
                name="sz-courier"
                value={form.courierKey}
                options={SHIPPING_COURIER_OPTIONS}
                onValueChange={(value) => {
                  setForm((prev) => ({ ...prev, courierKey: value as ShippingCourierKey }));
                  if (errors.courierKey) {
                    setErrors((prev) => ({ ...prev, courierKey: undefined }));
                  }
                }}
                error={errors.courierKey}
              />

              <SelectField
                label="Price Type"
                name="sz-price-type"
                value={form.priceType}
                options={SHIPPING_PRICE_TYPE_OPTIONS}
                onValueChange={handlePriceTypeChange}
              />

              <TextField
                label="Price Amount (RM)"
                name="sz-price"
                value={form.priceAmount}
                onValueChange={(value) => {
                  setForm((prev) => ({ ...prev, priceAmount: value }));
                  if (errors.priceAmount) {
                    setErrors((prev) => ({ ...prev, priceAmount: undefined }));
                  }
                }}
                placeholder={
                  form.priceType === "api" ? "Provided by the shipping API" : "e.g. 8.00"
                }
                inputMode="decimal"
                disabled={form.priceType === "api"}
                error={errors.priceAmount}
              />

              <p className="sz__hint">{priceHint(form.priceType)}</p>

              <SelectField
                label="Status"
                name="sz-status"
                value={form.status}
                options={SHIPPING_ZONE_STATUS_OPTIONS}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, status: value as ShippingZoneStatus }))
                }
              />

              {formError ? (
                <p className="pd-modal__error" role="alert">
                  {formError}
                </p>
              ) : null}

              <div className="pd-modal__actions">
                <Button variant="secondary" onClick={closeModal} disabled={saving}>
                  Cancel
                </Button>
                <Button type="submit" loading={saving}>
                  {editingId === null ? "Create Zone" : "Save changes"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </Shell>
  );
}
