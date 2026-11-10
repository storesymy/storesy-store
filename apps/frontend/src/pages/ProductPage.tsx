import { Button, Icon, Shell } from "@storesy/ui";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { PRODUCT_PRICE_MAX_CENTS, PRODUCT_STOCK_MAX, GALLERY_LIMIT, DOWNLOAD_FILES_LIMIT, DOWNLOAD_FILE_MAX_BYTES } from "@storesy/shared";
import type { DownloadFile, Product, ProductFulfilment } from "@storesy/shared";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { buildNav, SYSTEM_MENU } from "../lib/nav";
import { imageSrc, formatBytes, parseUnit, priceToCents } from "../lib/product";
import { useTheme } from "../lib/theme";
import { ImageCropModal } from "../components/ImageCropModal";

type LoadState = "loading" | "ready" | "missing" | "error";
type ProductStatus = "active" | "draft";

/** Which image a pick is headed for — featured replaces, gallery appends. */
type CropTarget = "featured" | "gallery";

/** A gallery tile: a stored path from the API, or a crop waiting for save. */
type GalleryItem =
  | { kind: "saved"; path: string }
  | { kind: "pending"; blob: Blob; preview: string };

/** A digital file in the picker: bytes waiting for save, or a stored entry. */
type FileEntry =
  | { kind: "stored"; path: string; name: string; size: number }
  | { kind: "pending"; file: File; name: string; size: number; hash: string };

type ProductForm = {
  name: string;
  description: string;
  sku: string;
  /** Units on hand — whole count, `"0"` until counted. */
  stock: string;
  /** Display price in ringgit, e.g. `"19.90"` — converted to cents on save. */
  price: string;
  /** Discount price in ringgit (`""` = no discount) — cents on save. */
  discountPrice: string;
  /** Shipping weight in kg (`""` = unset). */
  weightKg: string;
  /** Shipping box W/H/L in cm (`""` = unset). */
  widthCm: string;
  heightCm: string;
  lengthCm: string;
  /** Merchant-supplied digital delivery URLs (one input per link). */
  downloadLinks: string[];
  /** Fulfilment channels (Shipment / Download) — at least one stays on. */
  fulfilment: ProductFulfilment;
  status: ProductStatus;
};

const STATUS_OPTIONS: Array<{ value: ProductStatus; label: string }> = [
  { value: "active", label: "Active" },
  { value: "draft", label: "Draft" },
];

const DIM_FIELDS = [
  { key: "widthCm", label: "Width" },
  { key: "heightCm", label: "Height" },
  { key: "lengthCm", label: "Length" },
] as const;

type DimKey = (typeof DIM_FIELDS)[number]["key"];

const FULFILMENT_OPTIONS = [
  { key: "shipment", label: "Shipment" },
  { key: "download", label: "Download" },
] as const;

type FulfilmentKey = (typeof FULFILMENT_OPTIONS)[number]["key"];

const GALLERY_MAX = GALLERY_LIMIT;
const DOWNLOAD_LINKS_MAX = 10;
/** Square output resolutions the cropper renders (featured is the hero image). */
const FEATURED_OUTPUT = 1024;
const GALLERY_OUTPUT = 800;

function toForm(row: Product): ProductForm {
  return {
    name: row.name,
    description: row.description,
    sku: row.sku,
    stock: String(row.stock),
    price: (row.price / 100).toFixed(2),
    discountPrice:
      row.discountPrice === null ? "" : (row.discountPrice / 100).toFixed(2),
    weightKg: row.weightKg != null ? String(row.weightKg) : "",
    widthCm: row.widthCm != null ? String(row.widthCm) : "",
    heightCm: row.heightCm != null ? String(row.heightCm) : "",
    lengthCm: row.lengthCm != null ? String(row.lengthCm) : "",
    downloadLinks: [...row.downloadLinks],
    fulfilment: { ...row.fulfilment },
    status: row.status,
  };
}

/** ui-field wrapper that carries the invalid border + error slot (no label). */
function controlClass(error: string | undefined): string {
  return ["ui-field", error && "ui-field--invalid"].filter(Boolean).join(" ");
}

/**
 * One field row: label + description on the left, the control on the right.
 * Collapses to a single column (label above control) on narrow screens.
 * The label is optional — the actions row reuses the control column.
 */
function FormRow({
  label,
  htmlFor,
  description,
  children,
}: {
  label?: string;
  htmlFor?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="pdp__formRow">
      <div className="pdp__formLabel">
        {label && htmlFor ? (
          <label className="pdp__formLabelText" htmlFor={htmlFor}>
            {label}
          </label>
        ) : label ? (
          <span className="pdp__formLabelText">{label}</span>
        ) : null}
        {description ? <p className="pdp__formDesc">{description}</p> : null}
      </div>
      <div className="pdp__formControl">{children}</div>
    </div>
  );
}

/** Pill-style radio group (Status) — check dot when selected. */
function RadioPills<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="pd__typeGroup" role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            className={selected ? "pd__typeOption pd__typeOption--active" : "pd__typeOption"}
            onClick={() => onChange(option.value)}
          >
            <span
              className={selected ? "pd__typeDot pd__typeDot--on" : "pd__typeDot"}
              aria-hidden="true"
            >
              {selected ? <Icon name="check" size={11} /> : null}
            </span>
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Product edit at /product/:uuid — reached from the Manage button on
 * /products. The header (back arrow → product list) and the form panel share
 * the same offset column (8 wide, 2 from the left). Every field is its own
 * row: label + description left, control right (stacked on mobile). The form
 * edits name, description, SKU, inventory, RM price, discount, images, fulfilment
 * (Shipment / Download), shipment (weight/box), digital download and status
 * through PATCH; the save button
 * sits in a control row too. Images and the uploaded file are local
 * previews until storage lands.
 */
export function ProductPage() {
  const { uuid } = useParams();
  const { user, loading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const [product, setProduct] = useState<Product | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [form, setForm] = useState<ProductForm>({
    name: "",
    description: "",
    sku: "",
    stock: "0",
    price: "0.00",
    discountPrice: "",
    weightKg: "",
    widthCm: "",
    heightCm: "",
    lengthCm: "",
    downloadLinks: [],
    fulfilment: { shipment: true, download: false },
    status: "active",
  });
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [stockError, setStockError] = useState<string | undefined>(undefined);
  const [priceError, setPriceError] = useState<string | undefined>(undefined);
  const [discountError, setDiscountError] = useState<string | undefined>(undefined);
  const [weightError, setWeightError] = useState<string | undefined>(undefined);
  const [dimError, setDimError] = useState<string | undefined>(undefined);
  const [linkError, setLinkError] = useState<string | undefined>(undefined);
  const [fulfilmentError, setFulfilmentError] = useState<string | undefined>(undefined);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Cropped pictures: pending blobs wait for Save (that's when they upload,
  // to R2); saved paths render straight from /api/images. The crop dialog
  // holds the picked file until the user applies or cancels it.
  const [featuredSaved, setFeaturedSaved] = useState<string | null>(null);
  const [featuredPending, setFeaturedPending] = useState<{
    blob: Blob;
    preview: string;
  } | null>(null);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [crop, setCrop] = useState<{
    src: string;
    target: CropTarget;
    outputSize: number;
    /** The tile's display box — the crop window mirrors its ratio. */
    frameBox?: { width: number; height: number };
  } | null>(null);
  // Digital files: pending picks keep their bytes until Save (that's when
  // they upload, deduped by content hash); stored entries came back from the
  // API with name + size for the chips.
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [fileNote, setFileNote] = useState<string | undefined>(undefined);
  const featuredInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const downloadFileRef = useRef<HTMLInputElement>(null);
  const mediaUrls = useRef<string[]>([]);

  useEffect(
    () => () => {
      for (const url of mediaUrls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  useEffect(() => {
    if (!uuid) return;
    let cancelled = false;
    setState("loading");
    api
      .product(uuid)
      .then((row) => {
        if (cancelled) return;
        setProduct(row);
        setForm(toForm(row));
        setFeaturedSaved(row.featured);
        setFeaturedPending(null);
        setGallery(row.gallery.map((path) => ({ kind: "saved", path })));
        setFiles(
          row.downloadFiles.map(({ path, name, size }) => ({ kind: "stored", path, name, size })),
        );
        setState("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // Session died mid-tab: bounce to login like a signed-out user.
        if (error instanceof ApiError && error.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        if (error instanceof ApiError && error.status === 404) {
          setState("missing");
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : "Could not load this product.");
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [uuid, navigate, reloadKey]);

  if (loading) {
    return (
      <div className="page-loading" role="status">
        Loading…
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (!uuid) return <Navigate to="/products" replace />;

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  function goBack() {
    navigate("/products");
  }

  function touched() {
    if (saved) setSaved(false);
  }

  function trackUrl(url: string): string {
    mediaUrls.current.push(url);
    return url;
  }

  // Pickers don't preview directly anymore: a chosen file goes straight into
  // the crop dialog, and only the crop (a fresh Blob) enters form state.
  function handleImagePick(event: ChangeEvent<HTMLInputElement>, target: CropTarget) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const src = trackUrl(URL.createObjectURL(file));
    // Measure the tile this image will live in — the crop window mirrors it,
    // so the framed crop is exactly what the tile shows.
    const tile =
      target === "featured"
        ? event.target.closest(".pdp__featured")
        : (event.target.closest(".pdp__gallery")?.querySelector(".pdp__tile, .pdp__galleryAdd") ??
          null);
    const rect = tile?.getBoundingClientRect();
    setCrop({
      src,
      target,
      outputSize: target === "featured" ? FEATURED_OUTPUT : GALLERY_OUTPUT,
      frameBox:
        rect && rect.width > 0 && rect.height > 0
          ? { width: rect.width, height: rect.height }
          : undefined,
    });
  }

  function applyCrop(blob: Blob) {
    if (!crop) return;
    const { src, target } = crop;
    const preview = trackUrl(URL.createObjectURL(blob));
    URL.revokeObjectURL(src);
    setCrop(null);
    if (target === "featured") {
      const previous = featuredPending;
      setFeaturedPending({ blob, preview });
      if (previous) URL.revokeObjectURL(previous.preview);
    } else if (gallery.length < GALLERY_MAX) {
      setGallery([...gallery, { kind: "pending", blob, preview }]);
    } else {
      // Gallery is full — the crop never entered state, so drop its preview.
      URL.revokeObjectURL(preview);
    }
    touched();
  }

  function cancelCrop() {
    if (!crop) return;
    URL.revokeObjectURL(crop.src);
    setCrop(null);
  }

  function removeFeatured() {
    // Remove what's on top first: discarding a new crop reveals the saved one.
    if (featuredPending) {
      URL.revokeObjectURL(featuredPending.preview);
      setFeaturedPending(null);
    } else {
      setFeaturedSaved(null);
    }
    touched();
  }

  function removeGalleryAt(index: number) {
    const item = gallery[index];
    if (item?.kind === "pending") URL.revokeObjectURL(item.preview);
    setGallery(gallery.filter((_, i) => i !== index));
    touched();
  }

  /** Content hash of a pick — identical bytes must never list twice. */
  async function sha256(file: File): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function handleFilesPick(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (picked.length === 0) return;
    void addFiles(picked);
  }

  async function addFiles(picked: File[]) {
    const accepted: FileEntry[] = [];
    const seen = new Set<string>();
    const duplicates: string[] = [];
    const rejected: string[] = [];
    for (const file of picked) {
      if (file.size > DOWNLOAD_FILE_MAX_BYTES) {
        rejected.push(`${file.name} — over 50 MB`);
        continue;
      }
      const hash = await sha256(file);
      // Stored paths embed the same hash, so one check covers both kinds.
      const isDuplicate =
        seen.has(hash) ||
        files.some((entry) =>
          entry.kind === "pending" ? entry.hash === hash : entry.path.includes(hash),
        );
      if (isDuplicate) {
        duplicates.push(file.name);
        continue;
      }
      seen.add(hash);
      accepted.push({ kind: "pending", file, name: file.name, size: file.size, hash });
    }
    const fits = accepted.slice(0, Math.max(0, DOWNLOAD_FILES_LIMIT - files.length));
    const overCap = accepted.length > fits.length;
    if (fits.length > 0) setFiles([...files, ...fits]);
    const notes = [
      duplicates.length > 0 ? `${duplicates.join(", ")} — already in the list` : "",
      ...rejected,
      overCap ? `Up to ${DOWNLOAD_FILES_LIMIT} files` : "",
    ].filter(Boolean);
    setFileNote(notes.length > 0 ? notes.join(" · ") : undefined);
    touched();
  }

  function removeFileAt(index: number) {
    setFiles(files.filter((_, i) => i !== index));
    setFileNote(undefined);
    touched();
  }

  function setDim(key: DimKey, value: string) {
    setForm((prev) => {
      const next: ProductForm = { ...prev };
      next[key] = value;
      return next;
    });
  }

  function setFulfilment(key: FulfilmentKey, checked: boolean) {
    setForm((prev) => {
      const next: ProductForm = { ...prev };
      next.fulfilment = { ...next.fulfilment };
      next.fulfilment[key] = checked;
      return next;
    });
  }

  function setLinkAt(index: number, value: string) {
    setForm((prev) => {
      const next: ProductForm = { ...prev };
      next.downloadLinks = [...prev.downloadLinks];
      next.downloadLinks[index] = value;
      return next;
    });
  }

  function addLink() {
    setForm((prev) => ({ ...prev, downloadLinks: [...prev.downloadLinks, ""] }));
    touched();
  }

  function removeLinkAt(index: number) {
    setForm((prev) => ({
      ...prev,
      downloadLinks: prev.downloadLinks.filter((_, i) => i !== index),
    }));
    touched();
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!product) return;
    const name = form.name.trim();
    if (name.length < 2) {
      setNameError("Give the product a name.");
      return;
    }
    // Empty counts as 0 — inventory is a whole-unit count, never null.
    const stock = parseUnit(form.stock) ?? 0;
    if (Number.isNaN(stock) || !Number.isInteger(stock) || stock < 0) {
      setStockError("Enter whole units, e.g. 12.");
      return;
    }
    if (stock > PRODUCT_STOCK_MAX) {
      setStockError("Stock is too high.");
      return;
    }
    const cents = priceToCents(form.price);
    if (cents === null) {
      setPriceError("Enter a valid price, e.g. 19.90.");
      return;
    }
    if (cents > PRODUCT_PRICE_MAX_CENTS) {
      setPriceError("Price is too high.");
      return;
    }
    const discountPrice =
      form.discountPrice.trim() === "" ? null : priceToCents(form.discountPrice);
    if (form.discountPrice.trim() !== "" && discountPrice === null) {
      setDiscountError("Enter a valid discount, e.g. 19.90.");
      return;
    }
    if (discountPrice !== null && discountPrice > PRODUCT_PRICE_MAX_CENTS) {
      setDiscountError("Discount price is too high.");
      return;
    }
    if (discountPrice !== null && discountPrice >= cents) {
      setDiscountError("Discount price must be lower than the price.");
      return;
    }
    const weightKg = parseUnit(form.weightKg);
    if (Number.isNaN(weightKg)) {
      setWeightError("Enter a weight in kg, e.g. 1.25.");
      return;
    }
    const widthCm = parseUnit(form.widthCm);
    const heightCm = parseUnit(form.heightCm);
    const lengthCm = parseUnit(form.lengthCm);
    if (Number.isNaN(widthCm) || Number.isNaN(heightCm) || Number.isNaN(lengthCm)) {
      setDimError("Enter dimensions in cm, e.g. 12.");
      return;
    }
    const downloadLinks = form.downloadLinks
      .map((link) => link.trim())
      .filter((link) => link !== "");
    if (downloadLinks.some((link) => !/^https?:\/\/\S+$/.test(link))) {
      setLinkError("Links need the full address, e.g. https://…");
      return;
    }
    if (!form.fulfilment.shipment && !form.fulfilment.download) {
      setFulfilmentError("Keep at least one fulfilment option on.");
      return;
    }
    setSaving(true);
    setSaveError(undefined);
    try {
      // Cropped pictures only reach storage now: each pending blob uploads
      // and hands back the path the row stores. Stored paths pass through
      // untouched — the server drops objects the row no longer references.
      let featured = featuredSaved;
      if (featuredPending) {
        featured = await api.uploadImage(product.id, featuredPending.blob);
      }
      const galleryPaths: string[] = [];
      for (const item of gallery) {
        galleryPaths.push(
          item.kind === "saved" ? item.path : await api.uploadImage(product.id, item.blob),
        );
      }
      const storedFiles: DownloadFile[] = [];
      for (const entry of files) {
        storedFiles.push(
          entry.kind === "stored"
            ? { path: entry.path, name: entry.name, size: entry.size }
            : await api.uploadFile(product.id, entry.file),
        );
      }
      const updated = await api.updateProduct(product.id, {
        name,
        description: form.description.trim(),
        sku: form.sku.trim(),
        stock,
        price: cents,
        discountPrice,
        status: form.status,
        weightKg,
        widthCm,
        heightCm,
        lengthCm,
        featured,
        gallery: galleryPaths,
        downloadLinks,
        downloadFiles: storedFiles,
        fulfilment: form.fulfilment,
      });
      setProduct(updated);
      setForm(toForm(updated));
      // Adopt the stored paths; pending previews stay tracked for unmount.
      setFeaturedSaved(updated.featured);
      setFeaturedPending(null);
      setGallery(updated.gallery.map((path) => ({ kind: "saved", path })));
      setFiles(
        updated.downloadFiles.map(({ path, name, size }) => ({
          kind: "stored",
          path,
          name,
          size,
        })),
      );
      setSaved(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        navigate("/login", { replace: true });
        return;
      }
      if (error instanceof ApiError && error.fields) {
        const fields = error.fields;
        if (fields.name) setNameError(fields.name);
        if (fields.stock) setStockError(fields.stock);
        if (fields.price) setPriceError(fields.price);
        if (fields.discountPrice) setDiscountError(fields.discountPrice);
        if (fields.weightKg) setWeightError(fields.weightKg);
        if (fields.widthCm || fields.heightCm || fields.lengthCm) {
          setDimError(fields.widthCm ?? fields.heightCm ?? fields.lengthCm);
        }
        if (fields.downloadLinks) setLinkError(fields.downloadLinks);
        if (fields.fulfilment) setFulfilmentError(fields.fulfilment);
        const mapped = [
          "name",
          "stock",
          "price",
          "discountPrice",
          "weightKg",
          "widthCm",
          "heightCm",
          "lengthCm",
          "downloadLinks",
          "fulfilment",
        ];
        const extra = Object.entries(fields).find(([key]) => !mapped.includes(key));
        if (extra) setSaveError(extra[1]);
        else if (Object.keys(fields).length === 0) setSaveError(error.message);
        return;
      }
      setSaveError(error instanceof ApiError ? error.message : "Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  // Displayed featured image: a fresh crop while one waits, else the stored
  // path served from /api/images.
  const featuredSrc = featuredPending?.preview ?? (featuredSaved ? imageSrc(featuredSaved) : null);

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
      menuLinks={user.role === "owner" ? SYSTEM_MENU : undefined}
    >
      <div className="pdp">
        {state === "loading" ? (
          <div className="page-loading" role="status">
            Loading product…
          </div>
        ) : null}

        {state === "missing" ? (
          <div className="pd__empty">
            <Icon name="bag" size={22} className="pd__emptyIcon" />
            <p className="pd__emptyTitle">Product not found</p>
            <p className="pd__emptyHint">It may have been removed, or the link is wrong.</p>
            <Button onClick={goBack}>Back to products</Button>
          </div>
        ) : null}

        {state === "error" ? (
          <div className="pd__empty">
            <Icon name="bag" size={22} className="pd__emptyIcon" />
            <p className="pd__emptyTitle">Could not load this product</p>
            <p className="pd__emptyHint">{errorMessage}</p>
            <div className="pd__emptyActions">
              <button
                type="button"
                className="pd__clear"
                onClick={() => setReloadKey((key) => key + 1)}
              >
                Try again
              </button>
              <Button variant="secondary" onClick={goBack}>
                Back to products
              </Button>
            </div>
          </div>
        ) : null}

        {state === "ready" && product ? (
          <div className="pdp__layout">
            <header className="pdp__head">
              <button
                type="button"
                className="pdp__back"
                aria-label="Back to products"
                onClick={goBack}
              >
                <Icon name="arrowLeft" size={18} />
              </button>
              <div className="pdp__ident">
                <h1 className="pdp__title">{product.name}</h1>
                <span className="pdp__code">{product.code}</span>
              </div>
              <span
                className={
                  product.status === "active" ? "pd__pill pd__pill--live" : "pd__pill"
                }
              >
                {product.status === "active" ? "Active" : "Draft"}
              </span>
            </header>

            <div className="pdp__panel">
              <form className="pdp__form" onSubmit={handleSave} noValidate>
                <FormRow
                  label="Name"
                  htmlFor="pdp-name"
                  description="What customers see across your store."
                >
                  <div className={controlClass(nameError)}>
                    <input
                      id="pdp-name"
                      name="pdp-name"
                      className="ui-field__input"
                      value={form.name}
                      placeholder="e.g. Aurora Desk Lamp"
                      aria-invalid={Boolean(nameError)}
                      aria-describedby={nameError ? "pdp-name-error" : undefined}
                      onChange={(event) => {
                        setForm((prev) => ({ ...prev, name: event.target.value }));
                        if (nameError) setNameError(undefined);
                        touched();
                      }}
                    />
                    {nameError ? (
                      <p className="ui-field__error" id="pdp-name-error" role="alert">
                        {nameError}
                      </p>
                    ) : null}
                  </div>
                </FormRow>

                <FormRow
                  label="Description"
                  htmlFor="pdp-description"
                  description="Long-form copy about the product."
                >
                  <div className="ui-field">
                    <textarea
                      id="pdp-description"
                      name="pdp-description"
                      className="ui-field__input pdp__textarea"
                      rows={4}
                      maxLength={5000}
                      value={form.description}
                      placeholder="What makes this product worth buying…"
                      onChange={(event) => {
                        setForm((prev) => ({ ...prev, description: event.target.value }));
                        touched();
                      }}
                    />
                  </div>
                </FormRow>

                <FormRow label="SKU" htmlFor="pdp-sku" description="Your own stock-keeping unit — optional.">
                  <div className="ui-field">
                    <input
                      id="pdp-sku"
                      name="pdp-sku"
                      className="ui-field__input"
                      value={form.sku}
                      placeholder="SKU-1001"
                      onChange={(event) => {
                        setForm((prev) => ({ ...prev, sku: event.target.value }));
                        touched();
                      }}
                    />
                  </div>
                </FormRow>

                <FormRow
                  label="Inventory"
                  htmlFor="pdp-stock"
                  description="Units on hand — what you can sell."
                >
                  <div className={controlClass(stockError)}>
                    <input
                      id="pdp-stock"
                      name="pdp-stock"
                      className="ui-field__input"
                      inputMode="numeric"
                      placeholder="0"
                      value={form.stock}
                      aria-invalid={Boolean(stockError)}
                      aria-describedby={stockError ? "pdp-stock-error" : undefined}
                      onChange={(event) => {
                        setForm((prev) => ({ ...prev, stock: event.target.value }));
                        if (stockError) setStockError(undefined);
                        touched();
                      }}
                    />
                    {stockError ? (
                      <p className="ui-field__error" id="pdp-stock-error" role="alert">
                        {stockError}
                      </p>
                    ) : null}
                  </div>
                </FormRow>

                <FormRow label="Price" htmlFor="pdp-price" description="Set in Malaysian ringgit (RM).">
                  <div className={controlClass(priceError)}>
                    <div className="pdp__priceBox">
                      <span className="pdp__pricePrefix" aria-hidden="true">
                        RM
                      </span>
                      <input
                        id="pdp-price"
                        name="pdp-price"
                        className="pdp__priceInput"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={form.price}
                        aria-invalid={Boolean(priceError)}
                        aria-describedby={priceError ? "pdp-price-error" : undefined}
                        onChange={(event) => {
                          setForm((prev) => ({ ...prev, price: event.target.value }));
                          if (priceError) setPriceError(undefined);
                          touched();
                        }}
                      />
                    </div>
                    {priceError ? (
                      <p className="ui-field__error" id="pdp-price-error" role="alert">
                        {priceError}
                      </p>
                    ) : null}
                  </div>
                </FormRow>

                <FormRow
                  label="Discount Price"
                  htmlFor="pdp-discount-price"
                  description="Optional sale price in ringgit (RM)."
                >
                  <div className={controlClass(discountError)}>
                    <div className="pdp__priceBox">
                      <span className="pdp__pricePrefix" aria-hidden="true">
                        RM
                      </span>
                      <input
                        id="pdp-discount-price"
                        name="pdp-discount-price"
                        className="pdp__priceInput"
                        inputMode="decimal"
                        placeholder="—"
                        value={form.discountPrice}
                        aria-invalid={Boolean(discountError)}
                        aria-describedby={discountError ? "pdp-discount-price-error" : undefined}
                        onChange={(event) => {
                          setForm((prev) => ({ ...prev, discountPrice: event.target.value }));
                          if (discountError) setDiscountError(undefined);
                          touched();
                        }}
                      />
                    </div>
                    {discountError ? (
                      <p className="ui-field__error" id="pdp-discount-price-error" role="alert">
                        {discountError}
                      </p>
                    ) : null}
                  </div>
                </FormRow>

                <FormRow
                  label="Featured Image"
                  description="The crop window matches the tile below — it uploads when you save."
                >
                  <div className="pdp__featured">
                    <input
                      ref={featuredInputRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(event) => handleImagePick(event, "featured")}
                    />
                    {featuredSrc ? (
                      <>
                        <img
                          className="pdp__featuredImg"
                          src={featuredSrc}
                          alt="Featured product"
                        />
                        <button
                          type="button"
                          className="pdp__mediaRemove"
                          aria-label="Remove featured image"
                          onClick={removeFeatured}
                        >
                          <Icon name="close" size={11} />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="pdp__upload"
                        aria-label="Upload featured image"
                        onClick={() => featuredInputRef.current?.click()}
                      >
                        <Icon name="image" size={26} />
                        <span>Upload</span>
                      </button>
                    )}
                  </div>
                </FormRow>

                <FormRow label="Gallery" description={`${gallery.length} of ${GALLERY_MAX} images — each is cropped on pick.`}>
                  <div className="pdp__gallery">
                    <input
                      ref={galleryInputRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(event) => handleImagePick(event, "gallery")}
                    />
                    {gallery.map((item, index) => {
                      const src = item.kind === "saved" ? imageSrc(item.path) : item.preview;
                      return (
                        <div
                          className="pdp__tile"
                          key={item.kind === "saved" ? item.path : item.preview}
                        >
                          <img src={src} alt={`Gallery image ${index + 1}`} />
                          <button
                            type="button"
                            className="pdp__mediaRemove pdp__mediaRemove--sm"
                            aria-label={`Remove gallery image ${index + 1}`}
                            onClick={() => removeGalleryAt(index)}
                          >
                            <Icon name="close" size={9} />
                          </button>
                        </div>
                      );
                    })}
                    {gallery.length < GALLERY_MAX ? (
                      <button
                        type="button"
                        className="pdp__upload pdp__galleryAdd"
                        aria-label="Upload gallery image"
                        onClick={() => galleryInputRef.current?.click()}
                      >
                        <Icon name="image" size={20} />
                        <span>Upload</span>
                      </button>
                    ) : null}
                  </div>
                </FormRow>

                <FormRow
                  label="Fulfilment"
                  description="How the product reaches the customer — keep at least one on."
                >
                  <div className={controlClass(fulfilmentError)}>
                    <div className="pdp__checkGroup" role="group" aria-label="Fulfilment">
                      {FULFILMENT_OPTIONS.map((option) => {
                        const checked = form.fulfilment[option.key];
                        return (
                          <button
                            key={option.key}
                            type="button"
                            role="checkbox"
                            aria-checked={checked}
                            className={
                              checked
                                ? "pdp__checkOption pdp__checkOption--active"
                                : "pdp__checkOption"
                            }
                            onClick={() => {
                              setFulfilment(option.key, !checked);
                              if (fulfilmentError) setFulfilmentError(undefined);
                              touched();
                            }}
                          >
                            <span
                              className={
                                checked ? "pdp__checkBox pdp__checkBox--on" : "pdp__checkBox"
                              }
                              aria-hidden="true"
                            >
                              {checked ? <Icon name="check" size={11} /> : null}
                            </span>
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                    {fulfilmentError ? (
                      <p className="ui-field__error" id="pdp-fulfilment-error" role="alert">
                        {fulfilmentError}
                      </p>
                    ) : null}
                  </div>
                </FormRow>

                <FormRow label="Weight" description="In kilograms (kg).">
                  <div className={controlClass(weightError)}>
                    <div className="pdp__unitBox">
                      <input
                        id="pdp-weight"
                        name="pdp-weight"
                        className="pdp__unitInput"
                        inputMode="decimal"
                        placeholder="0.0"
                        value={form.weightKg}
                        aria-invalid={Boolean(weightError)}
                        aria-describedby={weightError ? "pdp-weight-error" : undefined}
                        onChange={(event) => {
                          setForm((prev) => ({ ...prev, weightKg: event.target.value }));
                          if (weightError) setWeightError(undefined);
                          touched();
                        }}
                      />
                      <span className="pdp__unitSuffix" aria-hidden="true">
                        kg
                      </span>
                    </div>
                    {weightError ? (
                      <p className="ui-field__error" id="pdp-weight-error" role="alert">
                        {weightError}
                      </p>
                    ) : null}
                  </div>
                </FormRow>

                <FormRow label="Dimensions" description="Shipping box in centimetres.">
                  <div className={controlClass(dimError)}>
                    <div className="pdp__dims">
                      {DIM_FIELDS.map((dim) => (
                        <div className="pdp__dim" key={dim.key}>
                          <span className="pdp__dimLabel">{dim.label}</span>
                          <div className="pdp__unitBox">
                            <input
                              id={`pdp-${dim.key}`}
                              name={`pdp-${dim.key}`}
                              className="pdp__unitInput"
                              inputMode="decimal"
                              placeholder="0"
                              value={form[dim.key]}
                              onChange={(event) => {
                                setDim(dim.key, event.target.value);
                                if (dimError) setDimError(undefined);
                                touched();
                              }}
                            />
                            <span className="pdp__unitSuffix" aria-hidden="true">
                              cm
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    {dimError ? (
                      <p className="ui-field__error" id="pdp-dims-error" role="alert">
                        {dimError}
                      </p>
                    ) : null}
                  </div>
                </FormRow>

                <FormRow
                  label="Download File"
                  description="Uploads when you save — up to 50 MB each."
                >
                  <div className="pdp__fileRow">
                    <input
                      ref={downloadFileRef}
                      type="file"
                      multiple
                      hidden
                      onChange={handleFilesPick}
                    />
                    {files.map((entry, index) => (
                      <span
                        className="pdp__fileChip"
                        key={entry.kind === "stored" ? entry.path : `pending-${entry.hash}`}
                      >
                        {entry.name}
                        <span className="pdp__fileChipSize">{formatBytes(entry.size)}</span>
                        <button
                          type="button"
                          className="pdp__fileChipX"
                          aria-label={`Remove ${entry.name}`}
                          onClick={() => removeFileAt(index)}
                        >
                          <Icon name="close" size={10} />
                        </button>
                      </span>
                    ))}
                    <button
                      type="button"
                      className="pdp__filePick"
                      onClick={() => downloadFileRef.current?.click()}
                    >
                      <Icon name="plus" size={14} />
                      Add file
                    </button>
                    {fileNote ? (
                      <p className="pdp__note" role="status">
                        {fileNote}
                      </p>
                    ) : null}
                  </div>
                </FormRow>

                <FormRow
                  label="Download link"
                  description="Where customers get the file — add as many as you need."
                >
                  <div className={controlClass(linkError)}>
                    <div className="pdp__links">
                      {form.downloadLinks.map((link, index) => (
                        <div className="pdp__linkRow" key={`link-${index}`}>
                          <input
                            id={`pdp-link-${index}`}
                            name={`pdp-link-${index}`}
                            className="ui-field__input"
                            type="url"
                            maxLength={500}
                            placeholder="https://…"
                            value={link}
                            aria-invalid={Boolean(linkError)}
                            aria-describedby={linkError ? "pdp-links-error" : undefined}
                            onChange={(event) => {
                              setLinkAt(index, event.target.value);
                              if (linkError) setLinkError(undefined);
                              touched();
                            }}
                          />
                          <button
                            type="button"
                            className="pdp__linkRemove"
                            aria-label={`Remove download link ${index + 1}`}
                            onClick={() => removeLinkAt(index)}
                          >
                            <Icon name="close" size={12} />
                          </button>
                        </div>
                      ))}
                      {form.downloadLinks.length < DOWNLOAD_LINKS_MAX ? (
                        <div>
                          <button type="button" className="pdp__filePick" onClick={addLink}>
                            <Icon name="plus" size={14} />
                            Add link
                          </button>
                        </div>
                      ) : null}
                    </div>
                    {linkError ? (
                      <p className="ui-field__error" id="pdp-links-error" role="alert">
                        {linkError}
                      </p>
                    ) : null}
                  </div>
                </FormRow>

                <FormRow label="Status" description="Active, or saved as a draft.">
                  <RadioPills
                    label="Status"
                    options={STATUS_OPTIONS}
                    value={form.status}
                    onChange={(status) => {
                      setForm((prev) => ({ ...prev, status }));
                      touched();
                    }}
                  />
                </FormRow>

                {saveError ? (
                  <p className="pd-modal__error" role="alert">
                    {saveError}
                  </p>
                ) : null}
                <FormRow>
                  <div className="pdp__actions">
                    <Button type="submit" loading={saving}>
                      Save changes
                    </Button>
                    {saved ? (
                      <span className="pdp__saved" role="status">
                        Saved
                      </span>
                    ) : null}
                  </div>
                </FormRow>
              </form>
            </div>
          </div>
        ) : null}
      </div>
      {crop ? (
        <ImageCropModal
          src={crop.src}
          outputSize={crop.outputSize}
          frameBox={crop.frameBox}
          onApply={applyCrop}
          onCancel={cancelCrop}
        />
      ) : null}
    </Shell>
  );
}
