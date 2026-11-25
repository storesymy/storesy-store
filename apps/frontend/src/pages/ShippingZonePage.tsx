import { COUNTRIES } from "@storesy/shared";
import { Button, Icon, SelectField, Shell, TextField } from "@storesy/ui";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { buildNav } from "../lib/nav";
import { formatPrice, priceToCents } from "../lib/product";
import { useTheme } from "../lib/theme";

type PriceType = "Flat" | "Follow API" | "API + Markup";
type ZoneStatus = "Active" | "Inactive";
type Courier = "MPA - J&T" | "MPA - Ninjavan" | "MPA - PosLaju" | "MPA - Aramex" | "MPA - Fedex";

interface ShippingZone {
  id: string;
  zone: string;
  courier: Courier;
  priceType: PriceType;
  /** Flat rate or API markup in cents; null for Follow API. */
  priceCents: number | null;
  status: ZoneStatus;
}

interface ZoneForm {
  zone: string;
  courier: Courier;
  priceType: PriceType;
  priceAmount: string;
  status: ZoneStatus;
}

const COURIERS: Courier[] = [
  "MPA - J&T",
  "MPA - Ninjavan",
  "MPA - PosLaju",
  "MPA - Aramex",
  "MPA - Fedex",
];

/**
 * One ordered list: Malaysia aggregates first, then every Malaysian state and
 * federal territory, then the countries (MY is omitted — "All State" covers
 * it).
 */
const ZONES: readonly string[] = [
  "Malaysia - All State",
  "Peninsular Malaysia",
  "Sabah-Sarawak",
  "Johor",
  "Kedah",
  "Kelantan",
  "Melaka",
  "Negeri Sembilan",
  "Pahang",
  "Perak",
  "Perlis",
  "Pulau Pinang",
  "Sabah",
  "Sarawak",
  "Selangor",
  "Terengganu",
  "Kuala Lumpur",
  "Labuan",
  "Putrajaya",
  ...COUNTRIES.filter((country) => country.code !== "MY").map(
    (country) => `${country.code} — ${country.name}`,
  ),
];

const PRICE_TYPES: PriceType[] = ["Flat", "Follow API", "API + Markup"];
const STATUSES: ZoneStatus[] = ["Active", "Inactive"];

const EMPTY_FORM: ZoneForm = {
  zone: "Malaysia - All State",
  courier: "MPA - J&T",
  priceType: "Flat",
  priceAmount: "",
  status: "Active",
};

function priceHint(priceType: PriceType): string {
  if (priceType === "Follow API") {
    return "The shipping API supplies the rate at checkout; no amount is stored.";
  }
  if (priceType === "API + Markup") {
    return "The API rate plus this amount is charged at checkout.";
  }
  return "A fixed rate charged for every order in this zone.";
}

/**
 * Shipping Zone — the pricing table and its create/edit dialog. UI only for
 * now: rows live in component state, so a refresh resets the preview. The API
 * will replace this state later.
 */
export function ShippingZonePage() {
  const { user, loading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const [zones, setZones] = useState<ShippingZone[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ZoneForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<{ zone?: string; priceAmount?: string }>({});

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
    setModalOpen(true);
  }

  function openEdit(zone: ShippingZone) {
    setEditingId(zone.id);
    setForm({
      zone: zone.zone,
      courier: zone.courier,
      priceType: zone.priceType,
      priceAmount: zone.priceCents === null ? "" : (zone.priceCents / 100).toFixed(2),
      status: zone.status,
    });
    setErrors({});
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingId(null);
    setErrors({});
  }

  function handlePriceTypeChange(value: string) {
    const priceType = value as PriceType;
    setForm((prev) => ({
      ...prev,
      priceType,
      priceAmount: priceType === "Follow API" ? "" : prev.priceAmount,
    }));
    if (errors.priceAmount) setErrors((prev) => ({ ...prev, priceAmount: undefined }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors: { zone?: string; priceAmount?: string } = {};
    if (form.zone === "") nextErrors.zone = "Choose a zone.";

    let priceCents: number | null = null;
    if (form.priceType !== "Follow API") {
      priceCents = priceToCents(form.priceAmount);
      if (priceCents === null) {
        nextErrors.priceAmount = "Enter a valid amount, e.g. 8.00.";
      }
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const zone: ShippingZone = {
      id: editingId ?? crypto.randomUUID(),
      zone: form.zone,
      courier: form.courier,
      priceType: form.priceType,
      priceCents,
      status: form.status,
    };

    setZones((prev) =>
      editingId === null ? [...prev, zone] : prev.map((row) => (row.id === editingId ? zone : row)),
    );
    closeModal();
  }

  if (loading) return null;
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

        <div className="pd__panel">
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
                    <td>{zone.zone}</td>
                    <td>{zone.courier}</td>
                    <td>{zone.priceType}</td>
                    <td className="pd__num">
                      {zone.priceType === "Follow API" || zone.priceCents === null
                        ? "—"
                        : formatPrice(zone.priceCents)}
                    </td>
                    <td>
                      <span
                        className={
                          zone.status === "Active" ? "pd__pill pd__pill--live" : "pd__pill"
                        }
                      >
                        {zone.status}
                      </span>
                    </td>
                    <td className="pd__action">
                      <div className="sz__actions">
                        <Button variant="secondary" onClick={() => openEdit(zone)}>
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() =>
                            setZones((prev) => prev.filter((row) => row.id !== zone.id))
                          }
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
                value={form.zone}
                options={ZONES}
                onValueChange={(value) => {
                  setForm((prev) => ({ ...prev, zone: value }));
                  if (errors.zone) setErrors((prev) => ({ ...prev, zone: undefined }));
                }}
                error={errors.zone}
              />

              <SelectField
                label="Courier"
                name="sz-courier"
                value={form.courier}
                options={COURIERS}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, courier: value as Courier }))
                }
              />

              <SelectField
                label="Price Type"
                name="sz-price-type"
                value={form.priceType}
                options={PRICE_TYPES}
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
                  form.priceType === "Follow API" ? "Provided by the shipping API" : "e.g. 8.00"
                }
                inputMode="decimal"
                disabled={form.priceType === "Follow API"}
                error={errors.priceAmount}
              />

              <p className="sz__hint">{priceHint(form.priceType)}</p>

              <SelectField
                label="Status"
                name="sz-status"
                value={form.status}
                options={STATUSES}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, status: value as ZoneStatus }))
                }
              />

              <div className="pd-modal__actions">
                <Button variant="secondary" onClick={closeModal}>
                  Cancel
                </Button>
                <Button type="submit">
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
