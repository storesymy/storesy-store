import { Icon } from "@storesy/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { GOOGLE_FONTS, FONT_CATEGORY_ORDER } from "../lib/googleFontCatalog";
import type { GoogleFontEntry } from "../lib/googleFontCatalog";
import { ensureGoogleFont, fontStack } from "../lib/googleFonts";

interface Props {
  current: string;
  onPick: (family: string) => void;
  onClose: () => void;
}

/** Long lists stay light: render a window, search reaches the rest. */
const RENDER_LIMIT = 150;

/** One browsable family — loads its stylesheet as it scrolls into view. */
function FontRow({
  font,
  active,
  onPick,
}: {
  font: GoogleFontEntry;
  active: boolean;
  onPick: (family: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const list = el.closest(".spfm__list");
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          ensureGoogleFont(font.family);
          observer.disconnect();
        }
      },
      { root: list, threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [font.family]);

  return (
    <button
      ref={ref}
      type="button"
      className={active ? "spfm__row spfm__row--active" : "spfm__row"}
      style={{ fontFamily: fontStack(font.family) }}
      onClick={() => onPick(font.family)}
    >
      <span className="spfm__name">{font.family}</span>
      <span className="spfm__cat">{font.category}</span>
    </button>
  );
}

/** Google Fonts browser: search + scrollable list, picks apply to the page. */
export function FontPickerModal({ current, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return GOOGLE_FONTS;
    return GOOGLE_FONTS.filter(
      (font) =>
        font.family.toLowerCase().includes(needle) ||
        font.category.toLowerCase().includes(needle),
    );
  }, [query]);

  const shown = results.slice(0, RENDER_LIMIT);

  return (
    <div className="pd-modal" role="presentation" onClick={onClose}>
      <div
        className="pd-modal__panel spfm"
        role="dialog"
        aria-modal="true"
        aria-label="Choose a Google Font"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="pd-modal__head">
          <div>
            <h2>Google Fonts</h2>
            <p className="spfm__sub">
              {results.length.toLocaleString("en-MY")} fonts · click one to apply
            </p>
          </div>
          <button
            type="button"
            className="pd-modal__close"
            aria-label="Close font picker"
            onClick={onClose}
          >
            <Icon name="close" size={15} />
          </button>
        </header>

        <div className="spfm__search">
          <input
            ref={searchRef}
            className="ui-field__input"
            type="search"
            placeholder="Search fonts…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="spfm__list">
          {shown.length === 0 ? (
            <div className="spfm__empty">
              <p>No fonts match “{query}”.</p>
              <span>Try another name — or part of one.</span>
            </div>
          ) : (
            shown.map((font) => (
              <FontRow
                key={font.family}
                font={font}
                active={font.family === current}
                onPick={onPick}
              />
            ))
          )}
        </div>

        <footer className="spfm__foot">
          <span>
            Showing {shown.length.toLocaleString("en-MY")} of{" "}
            {results.length.toLocaleString("en-MY")} · ordered by category then A–Z
          </span>
          <span className="spfm__cats">
            {FONT_CATEGORY_ORDER.map((category) => (
              <span key={category}>{category}</span>
            ))}
          </span>
        </footer>
      </div>
    </div>
  );
}
