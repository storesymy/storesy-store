import { Button, Card, Icon, Shell } from "@storesy/ui";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { CopyUrlButton } from "../components/CopyUrlButton";
import { Editable } from "../components/Editable";
import { EditableHtml } from "../components/EditableHtml";
import { ImportFileForm } from "../components/ImportFileForm";
import { ImportUrlForm } from "../components/ImportUrlForm";
import { SalesCheckout } from "../components/SalesCheckout";
import { SalesCheckoutPanel } from "../components/SalesCheckoutPanel";
import { SalesCodeView } from "../components/SalesCodeView";
import { SectionContent } from "../components/SalesSections";
import { SalesStylePanel } from "../components/SalesStylePanel";
import { SnapshotFrame } from "../components/SnapshotFrame";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ensureGoogleFont } from "../lib/googleFonts";
import { primaryButtonColors } from "../lib/salesPageDocument";
import type { FileImportOutcome, ImportOutcome } from "../lib/importUrl";
import { buildNav, SYSTEM_MENU } from "../lib/nav";
import {
  SECTION_ITEM_MAX,
  SECTION_KINDS,
  canvasStyleVars,
  defaultSection,
  defaultStyle,
  deleteSalesPage,
  getSalesPage,
  htmlFor,
  htmlTypeOf,
  isFramedHtml,
  isSnapshotHtml,
  kindFor,
  nowStamp,
  saveSalesPage,
} from "../lib/salesPages";
import type {
  SalesPage,
  SalesPageHtmlType,
  SalesPageStatus,
  SalesPageStyle,
  SalesSection,
  SectionType,
} from "../lib/salesPages";
import { useTheme } from "../lib/theme";

type Device = "laptop" | "mobile";
type Tab = "sections" | "style" | "import" | "ai" | "checkout" | "settings";
/** Canvas mode: the WYSIWYG canvas, or the HTML source + live preview. */
type Mode = "html" | "code";

export function SalesPageEditor() {
  const { user, loading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const { uuid } = useParams();

  // The document loads from the API: the row from D1, its documents hydrated
  // out of R2 by the server. `loadingPage` separates "still fetching" from a
  // real404, so the not-found card never flashes mid-load.
  const [page, setPage] = useState<SalesPage | null>(null);
  const [loadingPage, setLoadingPage] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>("laptop");
  const [mode, setMode] = useState<Mode>("html");
  const [tab, setTab] = useState<Tab>("sections");
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // The checkout preview must paint its pay button the way the saved document
  // will: the page's own primary button colour, when it declares one.
  const payColors = useMemo(
    () => (page ? primaryButtonColors(htmlFor(page, htmlTypeOf(page))) : null),
    [page],
  );
  // The status picker's "Delete" choice — an action, not a status, so it
  // waits here for a yes/no instead of ever landing on the document.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // The Import tab's first two doors — each waits here for a decision; the
  // third (Copy-paste) just flips the canvas, so it opens nothing.
  const [importUrlOpen, setImportUrlOpen] = useState(false);
  const [importFileOpen, setImportFileOpen] = useState(false);

  // Fetch the document once per editor mount (uuid is route-static). A 404
  // lands as null (the not-found card); a dead session bounces to login.
  useEffect(() => {
    if (!uuid) {
      setLoadingPage(false);
      return;
    }
    let alive = true;
    getSalesPage(uuid)
      .then((found) => {
        if (alive) setPage(found);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        if (error instanceof ApiError && error.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        console.error("salespage_load_failed", error);
        setPage(null);
      })
      .finally(() => {
        if (alive) setLoadingPage(false);
      });
    return () => {
      alive = false;
    };
  }, [uuid, navigate]);

  // The canvas's heading/body families come from Google Fonts — make sure the
  // stylesheets for the current values are in the document.
  useEffect(() => {
    if (!page) return;
    ensureGoogleFont(page.style.fontHead);
    ensureGoogleFont(page.style.fontBody);
  }, [page]);

  const toastTimer = useRef<number | undefined>(undefined);
  const sectionEls = useRef<Array<HTMLElement | null>>([]);
  // Latest document/flag for the unmount flush — refs survive the debounce
  // cleanup that runs when navigating away mid-edit.
  const pageRef = useRef(page);
  const dirtyRef = useRef(dirty);

  pageRef.current = page;
  dirtyRef.current = dirty;

  // Debounced autosave: edits settle for 600ms, then the PATCH queue
  // persists them (only dirty document slots ride the wire — see the store).
  // Dirty drops only when the save that finished still matches the latest
  // document; a newer edit keeps the flag and its own timer alive.
  useEffect(() => {
    if (!page || !dirty) return;
    const startedFor = page;
    const id = window.setTimeout(() => {
      saveSalesPage(startedFor)
        .then(() => {
          if (pageRef.current === startedFor) setDirty(false);
        })
        .catch((error: unknown) => {
          // The chip stays on "Unsaved changes"; the next edit retries.
          console.error("salespage_save_failed", error);
          if (error instanceof ApiError && error.status === 401) {
            navigate("/login", { replace: true });
          }
        });
    }, 600);
    return () => window.clearTimeout(id);
  }, [page, dirty, navigate]);

  // Navigating away before the debounce fires — write what we have.
  useEffect(
    () => () => {
      const latest = pageRef.current;
      if (latest && dirtyRef.current) {
        saveSalesPage(latest).catch((error) => console.error("salespage_flush_failed", error));
      }
    },
    [],
  );

  useEffect(
    () => () => {
      window.clearTimeout(toastTimer.current);
    },
    [],
  );

  // Escape backs out of the top layer: an import dialog first, then the
  // delete confirmation, then the current section selection.
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (importUrlOpen) setImportUrlOpen(false);
      else if (importFileOpen) setImportFileOpen(false);
      else if (confirmingDelete) setConfirmingDelete(false);
      else setSelectedId(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [importUrlOpen, importFileOpen, confirmingDelete]);

  if (loading || loadingPage) {
    return (
      <div className="page-loading" role="status">
        Loading…
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  function showToast(message: string) {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }

  if (!page) {
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
        <div className="pd__empty">
          <Icon name="layout" size={22} className="pd__emptyIcon" />
          <p className="pd__emptyTitle">Sales page not found</p>
          <p className="pd__emptyHint">It may have been removed, or the link is wrong.</p>
          <Button onClick={() => navigate("/salespages")}>Back to sales pages</Button>
        </div>
      </Shell>
    );
  }

  const sections = page.sections;
  const style: SalesPageStyle = { ...defaultStyle(), ...page.style };

  function update(patch: Partial<SalesPage>) {
    setPage((prev) => (prev ? { ...prev, ...patch, updatedAt: nowStamp() } : prev));
    setDirty(true);
  }

  // Confirmed in the dialog: the page is deleted server-side (row first, its
  // R2 documents after), then we leave. The dirty flag drops before the
  // request so the pending debounce and the unmount flush never write a page
  // that's on its way out.
  async function confirmDeletePage() {
    // Hoisted declaration, so the guard above can't be seen from in here.
    if (!page) return;
    setDirty(false);
    dirtyRef.current = false;
    try {
      await deleteSalesPage(page.id);
      navigate("/salespages");
    } catch (error) {
      console.error("salespage_delete_failed", error);
      showToast("Couldn't delete the page — try again.");
    }
  }

  /**
   * Content edit landed: the canvas just typed into THIS type's document, so
   * it writes the slot the Code view would. Autosave picks it up exactly like
   * a code edit, and the framed canvas holds its own DOM while editing rather
   * than re-rendering the srcdoc under the caret.
   */
  function writeContentEdit(next: string) {
    if (!page) return;
    update({ htmlByType: { ...page.htmlByType, [htmlTypeValue]: next } });
  }

  function patchStyle(patch: Partial<SalesPageStyle>) {
    update({ style: { ...style, ...patch } });
  }

  function writeSections(next: SalesSection[]) {
    setPage((prev) => (prev ? { ...prev, sections: next, updatedAt: nowStamp() } : prev));
    setDirty(true);
  }

  function addSection(type: SectionType, index?: number) {
    const section = defaultSection(type);
    const next = [...sections];
    next.splice(index ?? next.length, 0, section);
    writeSections(next);
    setSelectedId(section.id);
  }

  function patchSection(id: string, patch: Partial<SalesSection>) {
    writeSections(sections.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)));
  }

  function moveSection(id: string, dir: -1 | 1) {
    const index = sections.findIndex((entry) => entry.id === id);
    const target = index + dir;
    if (index < 0 || target < 0 || target >= sections.length) return;
    const next = [...sections];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    writeSections(next);
  }

  function removeSection(id: string) {
    writeSections(sections.filter((entry) => entry.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function addItem(id: string) {
    patchSection(id, {
      items: [
        ...sections.find((entry) => entry.id === id)?.items ?? [],
        { id: crypto.randomUUID(), text: "", detail: "" },
      ],
    });
  }

  function removeItem(id: string, itemIndex: number) {
    const entry = sections.find((section) => section.id === id);
    if (!entry || entry.items.length <= 1) return;
    patchSection(id, { items: entry.items.filter((_, index) => index !== itemIndex) });
  }

  /** Insertion index for a drag: before the first row whose midpoint is below. */
  function indexFromPoint(clientY: number): number {
    for (let index = 0; index < sections.length; index += 1) {
      const el = sectionEls.current[index];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return index;
    }
    return sections.length;
  }

  /**
   * "Import from URL" landed: the finished document becomes the **Import
   * Editor's** HTML (the type select switches to it so the result is on
   * screen) — the Component and AI documents stay untouched. Reset in Code
   * mode clears this slot alone. The canvas stays on the HTML preview: what
   * came in renders the moment it lands, exactly as buyers will see it.
   */
  function applyImport(outcome: ImportOutcome) {
    // Hoisted declaration — re-check the document the render already saw.
    if (!page) return;
    update({
      htmlByType: { ...page.htmlByType, code: outcome.html },
      htmlMode: "snapshot",
      source: { url: outcome.finalUrl, importedAt: nowStamp() },
      htmlType: "code",
    });
    let host = outcome.finalUrl;
    try {
      host = new URL(outcome.finalUrl).host;
    } catch {
      // Keep the raw string when the URL refuses to parse.
    }
    const sheets = outcome.sheetsInlined === 1 ? "stylesheet" : "stylesheets";
    const media = outcome.mediaReplaced === 1 ? "placeholder" : "placeholders";
    const lock =
      outcome.viewportLocked > 0
        ? ` Locked ${outcome.viewportLocked} viewport height${outcome.viewportLocked === 1 ? "" : "s"} to px.`
        : "";
    showToast(
      `Imported ${host} — ${outcome.sheetsInlined} ${sheets} inlined, ` +
        `${outcome.mediaReplaced} media ${media}.${lock} Swap pictures in with Change.`,
    );
  }

  /**
   * "Upload HTML file" landed: the local document becomes the **Import
   * Editor's** HTML through the same hygiene the URL pipeline runs, with the
   * file name taking the URL's place in the provenance record. Like every
   * import it lands on screen immediately — the HTML preview showing what
   * came in.
   */
  function applyFileImport(fileName: string, outcome: FileImportOutcome) {
    // Hoisted declaration — re-check the document the render already saw.
    if (!page) return;
    setImportFileOpen(false);
    update({
      htmlByType: { ...page.htmlByType, code: outcome.html },
      htmlMode: "snapshot",
      source: { url: `file://${fileName}`, importedAt: nowStamp() },
      htmlType: "code",
    });
    const media = outcome.mediaReplaced === 1 ? "placeholder" : "placeholders";
    const lock =
      outcome.viewportLocked > 0
        ? ` Locked ${outcome.viewportLocked} viewport height${outcome.viewportLocked === 1 ? "" : "s"} to px.`
        : "";
    showToast(
      `Imported ${fileName} — ${outcome.mediaReplaced} media ${media}.${lock} ` +
        `Swap pictures in with Change.`,
    );
  }

  /** Action card pick — stored once chosen, derived for older pages. */
  const htmlTypeValue: SalesPageHtmlType = htmlTypeOf(page);
  /** This type's own document — the only HTML the canvas and code view touch. */
  const activeHtml = htmlFor(page, htmlTypeValue);
  /** Its import flag — provenance, and the "Imported page" badge alone. */
  const activeSnapshot = isSnapshotHtml(page, htmlTypeValue);
  /**
   * Frame or inline: imports, plus any complete document typed or pasted into
   * the Code view — a full `<html>` document injected as markup would lose its
   * structure and paint its background over the whole app, so it gets a window.
   */
  const activeFramed = isFramedHtml(page, htmlTypeValue);

  /** Sections + Style belong to the Component Editor — hidden for the others. */
  const builderTabs = htmlTypeValue === "component";
  /**
   * The tab actually shown: each type only lists its own tabs, so anything
   * unreachable resolves to that type's home tab — Import for the Import
   * Editor (its whole job), AI for the AI Editor — and the Component tabs
   * come back on their own when the type returns to Component Editor.
   */
  const homeTab: Tab = builderTabs
    ? "sections"
    : htmlTypeValue === "code"
      ? "import"
      : "ai";
  function resolveTab(candidate: Tab): Tab {
    if (candidate === "sections" || candidate === "style") {
      return builderTabs ? candidate : homeTab;
    }
    if (candidate === "import") return htmlTypeValue === "code" ? "import" : homeTab;
    if (candidate === "ai") return htmlTypeValue === "ai" ? "ai" : homeTab;
    return candidate; // Checkout + Settings belong to every type.
  }
  const activeTab: Tab = resolveTab(tab);

  /**
   * The blank canvas speaks the active editor's language — a fresh page is an
   * empty Import Editor document, so it points at the import, not at sections
   * it has no tab for.
   */
  const emptyCopy =
    htmlTypeValue === "code"
      ? {
          icon: "code" as const,
          title: "Nothing imported yet",
          hint: "Pull a page in from the Import tab, or paste one into the Code view.",
        }
      : htmlTypeValue === "ai"
        ? {
            icon: "code" as const,
            title: "Nothing here yet",
            hint: "The AI Editor is coming soon.",
          }
        : {
            icon: "layout" as const,
            title: "Your page is empty",
            hint: "Drag a section in — or click one in the Sections tab.",
          };

  const site = (
    <div
      className="sf-frame__site spe__canvas"
      style={canvasStyleVars(style) as CSSProperties}
      onClick={() => setSelectedId(null)}
      onDragOver={(event) => {
        // The active type's document owns the canvas — drops have nothing to land on.
        if (activeHtml !== null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropIndex(indexFromPoint(event.clientY));
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropIndex(null);
      }}
      onDrop={(event) => {
        if (activeHtml !== null) return;
        event.preventDefault();
        const type = event.dataTransfer.getData("text/sales-section") as SectionType;
        const kind = SECTION_KINDS.find((entry) => entry.type === type);
        if (kind) addSection(kind.type, dropIndex ?? sections.length);
        setDropIndex(null);
      }}
    >
      {activeHtml !== null ? (
        <>
          {/* This editor's own document took over — not sections. A complete
              document — an import, or one typed by hand — mounts in a
              sandboxed frame: its own rules paint its own body, its own
              scripts run, sealed off from the app. Fragments stay inline so
              the Style tab still paints them. Either way the markup is
              editable in place — click text and reword it, no mode to turn
              on; the Code view remains the raw source. */}
          <span className="spe__htmlBadge">
            {activeSnapshot ? "Imported page" : "Custom HTML"}
          </span>
          {activeFramed ? (
            <SnapshotFrame html={activeHtml} onEdit={writeContentEdit} />
          ) : (
            <EditableHtml html={activeHtml} onEdit={writeContentEdit} className="spe__html" />
          )}
        </>
      ) : sections.length === 0 ? (
        <div className="spe__emptyCanvas">
          <Icon name={emptyCopy.icon} size={24} />
          <strong>{emptyCopy.title}</strong>
          <span>{emptyCopy.hint}</span>
        </div>
      ) : (
        <>
          {sections.map((section, index) => (
            <Fragment key={section.id}>
              {dropIndex === index ? <div className="spe__dropLine" /> : null}
              <div
                ref={(el) => {
                  sectionEls.current[index] = el;
                }}
                className={
                  selectedId === section.id
                    ? "spe__section spe__section--selected"
                    : "spe__section"
                }
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectedId(section.id);
                }}
              >
                <SectionContent
                  section={section}
                  iconSet={style.iconSet}
                  onChange={(patch) => patchSection(section.id, patch)}
                  onRemoveItem={(itemIndex) => removeItem(section.id, itemIndex)}
                />
                {selectedId === section.id ? (
                  <div className="spe__secTools" onClick={(event) => event.stopPropagation()}>
                    <span className="spe__secLabel">{kindFor(section.type).label}</span>
                    <button
                      type="button"
                      className="spe__toolBtn"
                      aria-label="Move up"
                      disabled={index === 0}
                      onClick={() => moveSection(section.id, -1)}
                    >
                      <Icon name="arrowUp" size={14} />
                    </button>
                    <button
                      type="button"
                      className="spe__toolBtn"
                      aria-label="Move down"
                      disabled={index === sections.length - 1}
                      onClick={() => moveSection(section.id, 1)}
                    >
                      <Icon name="arrowDown" size={14} />
                    </button>
                    <button
                      type="button"
                      className="spe__toolBtn spe__toolBtn--danger"
                      aria-label="Delete section"
                      onClick={() => removeSection(section.id)}
                    >
                      <Icon name="close" size={14} />
                    </button>
                    {kindFor(section.type).hasItems &&
                    section.items.length < SECTION_ITEM_MAX ? (
                      <button
                        type="button"
                        className="spe__toolBtn"
                        aria-label="Add row"
                        onClick={() => addItem(section.id)}
                      >
                        <Icon name="plus" size={14} />
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </Fragment>
          ))}
          {dropIndex === sections.length ? <div className="spe__dropLine" /> : null}
        </>
      )}
      {/* The checkout block is pinned to the bottom — Checkout tab toggles it
          and picks which products it sells. Framed documents get it as a
          rider at save time, so the pin previews that too. */}
      {style.checkout === "show" ? (
        <SalesCheckout productIds={page.checkoutProducts} payColors={payColors} />
      ) : null}
    </div>
  );

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
      <div className="sp">
        <header className="pd__header sp__header">
          <div className="sp__headLeft">
            <button
              type="button"
              className="sp__back"
              aria-label="Back to sales pages"
              onClick={() => navigate("/salespages")}
            >
              <Icon name="arrowLeft" size={16} />
            </button>
            <div className="sp__titleWrap">
              <h1 className="pd__title sp__title">
                <Editable
                  value={page.name}
                  onChange={(next) => update({ name: next })}
                  ariaLabel="Sales page name"
                  placeholder="Untitled sales page"
                />
              </h1>
              <span className="sp__slugRow">
                <span className="sp__slug">/{page.slug}</span>
                <span
                  className={page.status === "open" ? "pd__pill pd__pill--live" : "pd__pill"}
                >
                  {page.status === "open" ? "Open" : "Closed"}
                </span>
              </span>
            </div>
          </div>
          <div className="sp__headRight">
            {/* Autosave (debounced) is the only save now — no Save button. */}
            <span className={dirty ? "sp__saveState sp__saveState--dirty" : "sp__saveState"}>
              {dirty ? "Unsaved changes" : "All changes saved"}
            </span>
          </div>
        </header>

        <div className="sp__body">
          <div className="sp__stage">
            <div className="sf-frame">
              <div className="sf-frame__chrome">
                <span className="sf-frame__dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <div className="sf-frame__url">
                  <Icon name="lock" size={13} />
                  {/* The chrome URL opens the live page in a new tab. */}
                  <a
                    className="sf-frame__urlText"
                    href={`/${page.slug}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {window.location.host}/{page.slug}
                  </a>
                  <CopyUrlButton url={`/${page.slug}`} />
                </div>
                <div className="sf-frame__tools">
                  <span className="sf-frame__deviceGroup" role="group" aria-label="Screen size">
                    <button
                      type="button"
                      className={device === "laptop" ? "sf-tool sf-tool--active" : "sf-tool"}
                      aria-pressed={device === "laptop"}
                      aria-label="Laptop screen"
                      onClick={() => setDevice("laptop")}
                    >
                      <Icon name="monitor" size={15} />
                    </button>
                    <button
                      type="button"
                      className={device === "mobile" ? "sf-tool sf-tool--active" : "sf-tool"}
                      aria-pressed={device === "mobile"}
                      aria-label="Mobile screen"
                      onClick={() => setDevice("mobile")}
                    >
                      <Icon name="phone" size={15} />
                    </button>
                  </span>
                </div>
                <div className="sf-frame__mode" role="group" aria-label="Canvas mode">
                  {(
                    [
                      ["html", "HTML"],
                      ["code", "Code"],
                    ] as Array<[Mode, string]>
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={
                        mode === value ? "sf-frame__modeBtn sf-frame__modeBtn--active" : "sf-frame__modeBtn"
                      }
                      aria-pressed={mode === value}
                      onClick={() => setMode(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {mode === "code" ? (
                <SalesCodeView
                  html={activeHtml}
                  sections={sections}
                  style={style}
                  // Writes land in this type's slot only — the Component, Import
                  // and AI documents stay byte-for-byte independent.
                  onChange={(next) =>
                    update({ htmlByType: { ...page.htmlByType, [htmlTypeValue]: next } })
                  }
                  onReset={() => {
                    const htmlByType = { ...page.htmlByType };
                    delete htmlByType[htmlTypeValue];
                    const patch: Partial<SalesPage> = { htmlByType };
                    // Snapshot + source provenance belong to the Import slot alone.
                    if (htmlTypeValue === "code") {
                      patch.htmlMode = undefined;
                      patch.source = undefined;
                    }
                    update(patch);
                  }}
                />
              ) : (
                <div
                  className={
                    device === "mobile"
                      ? "sf-frame__stage sf-frame__stage--mobile"
                      : "sf-frame__stage"
                  }
                >
                  {device === "mobile" ? <div className="sf-frame__device">{site}</div> : site}
                </div>
              )}
            </div>
          </div>

          <aside className="sp__side" aria-label="Sales page tools">
            {/* Untitled action bar: how the HTML is authored, page status, publish. */}
            <Card>
              <div className="sp__actions">
                <select
                  className="sf-select sf-select--type"
                  aria-label="HTML type"
                  value={htmlTypeValue}
                  onChange={(event) =>
                    update({ htmlType: event.target.value as SalesPageHtmlType })
                  }
                >
                  <option value="component">Component Editor</option>
                  <option value="code">Import Editor</option>
                  <option value="ai">AI Editor</option>
                </select>
                <select
                  className="sf-select sf-select--status"
                  aria-label="Page status"
                  value={page.status}
                  onChange={(event) => {
                    const choice = event.target.value;
                    // "Delete" is not a status: the control snaps back to the
                    // page's real state and the confirmation takes over, so
                    // nothing is removed without a yes.
                    if (choice === "delete") {
                      event.currentTarget.value = page.status;
                      setConfirmingDelete(true);
                      return;
                    }
                    update({ status: choice as SalesPageStatus });
                  }}
                >
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                  <option value="delete">Delete</option>
                </select>
                {/* Publishing lands later — the button is inert for now. */}
                <Button>Publish</Button>
              </div>
            </Card>

            <div className="sp__rail">
              <div className="sp__tabs" role="tablist" aria-label="Editor panels">
                {builderTabs ? (
                  <>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeTab === "sections"}
                      className={activeTab === "sections" ? "sp__tab sp__tab--active" : "sp__tab"}
                      onClick={() => setTab("sections")}
                    >
                      Sections
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeTab === "style"}
                      className={activeTab === "style" ? "sp__tab sp__tab--active" : "sp__tab"}
                      onClick={() => setTab("style")}
                    >
                      Style
                    </button>
                  </>
                ) : null}
                {htmlTypeValue === "code" ? (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "import"}
                    className={activeTab === "import" ? "sp__tab sp__tab--active" : "sp__tab"}
                    onClick={() => setTab("import")}
                  >
                    Import
                  </button>
                ) : null}
                {htmlTypeValue === "ai" ? (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "ai"}
                    className={activeTab === "ai" ? "sp__tab sp__tab--active" : "sp__tab"}
                    onClick={() => setTab("ai")}
                  >
                    AI
                  </button>
                ) : null}
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "checkout"}
                  className={activeTab === "checkout" ? "sp__tab sp__tab--active" : "sp__tab"}
                  onClick={() => setTab("checkout")}
                >
                  Checkout
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "settings"}
                  className={activeTab === "settings" ? "sp__tab sp__tab--active" : "sp__tab"}
                  onClick={() => setTab("settings")}
                >
                  Settings
                </button>
              </div>

              {activeTab === "sections" ? (
                <div className="sp__panel" role="tabpanel" aria-label="Sections">
                  <p className="sp__hint">
                    Drag a section onto the page — or click to add it at the end.
                  </p>
                  {SECTION_KINDS.map((kind) => (
                    <button
                      key={kind.type}
                      type="button"
                      className="sp__sec"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData("text/sales-section", kind.type);
                        event.dataTransfer.effectAllowed = "copy";
                      }}
                      onClick={() => addSection(kind.type)}
                    >
                      <span className="sp__secIcon" aria-hidden="true">
                        <Icon name={kind.icon} size={16} />
                      </span>
                      <span className="sp__secText">
                        <span className="sp__secLabel">{kind.label}</span>
                        <span className="sp__secHint">{kind.hint}</span>
                      </span>
                      <Icon name="plus" size={14} className="sp__secAdd" />
                    </button>
                  ))}
                </div>
              ) : activeTab === "style" ? (
                <SalesStylePanel style={style} onPatch={patchStyle} />
              ) : activeTab === "import" ? (
                <div className="sp__panel" role="tabpanel" aria-label="Import">
                  {/* Three doors: fetch a page, drop a file, or go type it. */}
                  <p className="sp__hint">
                    Bring the page’s HTML in — or start typing it yourself.
                  </p>
                  <div className="imp__picks">
                    <button
                      type="button"
                      className="imp__pick"
                      onClick={() => setImportUrlOpen(true)}
                    >
                      <span className="imp__pickIcon" aria-hidden="true">
                        <Icon name="link" size={16} />
                      </span>
                      <span className="imp__pickText">
                        <span className="imp__pickLabel">Import from URL</span>
                        <span className="imp__pickHint">
                          Fetch a live page — styles inlined, pictures parked
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="imp__pick"
                      onClick={() => setImportFileOpen(true)}
                    >
                      <span className="imp__pickIcon" aria-hidden="true">
                        <Icon name="arrowUp" size={16} />
                      </span>
                      <span className="imp__pickText">
                        <span className="imp__pickLabel">Upload HTML file</span>
                        <span className="imp__pickHint">
                          A local .html document, up to 3 MB
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="imp__pick"
                      onClick={() => setMode("code")}
                    >
                      <span className="imp__pickIcon" aria-hidden="true">
                        <Icon name="code" size={16} />
                      </span>
                      <span className="imp__pickText">
                        <span className="imp__pickLabel">Copy-paste HTML Code</span>
                        <span className="imp__pickHint">
                          Opens Code mode — paste your markup in
                        </span>
                      </span>
                    </button>
                  </div>
                </div>
              ) : activeTab === "ai" ? (
                <div className="sp__panel" role="tabpanel" aria-label="AI">
                  <p className="sp__soon">Coming Soon</p>
                </div>
              ) : activeTab === "checkout" ? (
                <SalesCheckoutPanel
                  style={style}
                  onPatch={patchStyle}
                  selected={page.checkoutProducts}
                  onSelect={(checkoutProducts) => update({ checkoutProducts })}
                  paymentGateway={page.paymentGateway}
                  onGateway={(paymentGateway) => update({ paymentGateway })}
                  emailSender={page.emailSender}
                  onEmailSender={(emailSender) => update({ emailSender })}
                  trackings={page.trackings}
                  onTrackings={(trackings) => update({ trackings })}
                />
              ) : (
                <div className="sp__panel" role="tabpanel" aria-label="Settings">
                  <div className="sp__group">
                    <span className="sp__groupTitle">SEO</span>
                    <div className="ui-field">
                      <label className="ui-field__label" htmlFor="sp-seo-title">
                        Page title
                      </label>
                      <input
                        id="sp-seo-title"
                        className="ui-field__input"
                        value={page.seo.title}
                        placeholder="Search result title"
                        onChange={(event) => update({ seo: { ...page.seo, title: event.target.value } })}
                      />
                      <span className="sp__counter">{page.seo.title.length}/60</span>
                    </div>
                    <div className="ui-field">
                      <label className="ui-field__label" htmlFor="sp-seo-desc">
                        Meta description
                      </label>
                      <textarea
                        id="sp-seo-desc"
                        className="ui-field__input pdp__textarea"
                        value={page.seo.description}
                        placeholder="What searchers read under your link"
                        onChange={(event) =>
                          update({ seo: { ...page.seo, description: event.target.value } })
                        }
                      />
                      <span className="sp__counter">{page.seo.description.length}/160</span>
                    </div>
                    <div className="ui-field">
                      <label className="ui-field__label" htmlFor="sp-seo-keywords">
                        Keywords
                      </label>
                      <input
                        id="sp-seo-keywords"
                        className="ui-field__input"
                        value={page.seo.keywords}
                        placeholder="desk lamp, aurora, home"
                        onChange={(event) =>
                          update({ seo: { ...page.seo, keywords: event.target.value } })
                        }
                      />
                    </div>
                  </div>

                  <div className="sp__group">
                    <span className="sp__groupTitle">Open Graph</span>
                    <div className="ui-field">
                      <label className="ui-field__label" htmlFor="sp-og-title">
                        OG title
                      </label>
                      <input
                        id="sp-og-title"
                        className="ui-field__input"
                        value={page.og.title}
                        placeholder="Title when shared on social"
                        onChange={(event) => update({ og: { ...page.og, title: event.target.value } })}
                      />
                    </div>
                    <div className="ui-field">
                      <label className="ui-field__label" htmlFor="sp-og-desc">
                        OG description
                      </label>
                      <textarea
                        id="sp-og-desc"
                        className="ui-field__input pdp__textarea"
                        value={page.og.description}
                        placeholder="Snippet shown with the share"
                        onChange={(event) =>
                          update({ og: { ...page.og, description: event.target.value } })
                        }
                      />
                    </div>
                    <div className="ui-field">
                      <label className="ui-field__label" htmlFor="sp-og-image">
                        OG image URL
                      </label>
                      <input
                        id="sp-og-image"
                        className="ui-field__input"
                        value={page.og.image}
                        placeholder="https://…/share.jpg"
                        onChange={(event) => update({ og: { ...page.og, image: event.target.value } })}
                      />
                    </div>
                    <div className="sp__og">
                      <div
                        className="sp__ogImg"
                        style={
                          page.og.image
                            ? { backgroundImage: `url("${page.og.image}")` }
                            : undefined
                        }
                      >
                        {page.og.image ? null : <Icon name="image" size={18} />}
                      </div>
                      <div className="sp__ogText">
                        <span className="sp__ogHost">{window.location.host}</span>
                        <span className="sp__ogTitle">{page.og.title || page.name}</span>
                        <span className="sp__ogDesc">
                          {page.og.description ||
                            page.seo.description ||
                            "Add a description to preview how this page looks when shared."}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </aside>
        </div>
      </div>

      {toast ? (
        <div className="sf__toast" role="status">
          {toast}
        </div>
      ) : null}

      {/* The Import tab's URL and file doors — fixed-position overlays, so
          they live up here with the delete dialog rather than inside the
          rail. Both back out on Cancel, ✕, Escape or a backdrop click; only
          a finished import closes them for good. */}
      {importUrlOpen ? (
        <ImportUrlForm
          replacing={page.htmlByType.code != null}
          onClose={() => setImportUrlOpen(false)}
          onImported={(outcome) => {
            setImportUrlOpen(false);
            applyImport(outcome);
          }}
        />
      ) : null}
      {importFileOpen ? (
        <ImportFileForm
          replacing={page.htmlByType.code != null}
          onClose={() => setImportFileOpen(false)}
          onImported={applyFileImport}
        />
      ) : null}

      {/* The status picker's Delete, held here until someone says yes —
          Cancel, Escape, the ✕ or a click on the backdrop all back out and
          the picker simply keeps showing the page's real status. */}
      {confirmingDelete ? (
        <div
          className="pd-modal"
          role="presentation"
          onMouseDown={() => setConfirmingDelete(false)}
        >
          <div
            className="pd-modal__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sp-delete-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="pd-modal__head">
              <h2 id="sp-delete-title">Delete this sales page?</h2>
              <button
                type="button"
                className="pd-modal__close"
                aria-label="Close"
                onClick={() => setConfirmingDelete(false)}
              >
                <Icon name="close" size={15} />
              </button>
            </header>

            <div className="pd-modal__body">
              <p className="pd__deleteNote">
                <strong>{page.name}</strong> goes for good — its sections, HTML,
                checkout list, settings and URL. This can’t be undone.
              </p>
              <div className="pd-modal__actions">
                <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </Button>
                <Button variant="danger" onClick={confirmDeletePage}>
                  Delete page
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </Shell>
  );
}
