import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { sectionsHtml } from "../lib/salesHtml";
import type { SalesPageStyle, SalesSection } from "../lib/salesPages";

interface Props {
  /** Hand-edited source when present; otherwise the generated sections HTML. */
  html: string | null;
  sections: SalesSection[];
  style: SalesPageStyle;
  /** Fired per edit — the editor's dirty flag auto-saves it like canvas edits. */
  onChange: (next: string) => void;
  /** Discard the code edits and go back to rendering the section canvas. */
  onReset: () => void;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The attribute region of a tag: `name="value"` pairs and bare flags. */
function attrsHtml(attrs: string): string {
  const re = /([a-zA-Z_:@][\w:.-]*)(\s*=\s*)("[^"]*"|'[^']*')|([a-zA-Z_:@][\w:.-]*)/g;
  let out = "";
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(attrs)) !== null) {
    out += escapeHtml(attrs.slice(last, match.index));
    const valued = match[1] !== undefined;
    out += `<span class="spc-t-attr">${escapeHtml(match[1] ?? match[4] ?? "")}</span>`;
    if (valued) {
      out += escapeHtml(match[2] ?? "");
      out += `<span class="spc-t-str">${escapeHtml(match[3] ?? "")}</span>`;
    }
    last = match.index + match[0].length;
  }
  return out + escapeHtml(attrs.slice(last));
}

/** One tag: punctuation faint, tag name in the brand colour, attrs + strings. */
function tagHtml(tag: string): string {
  const parts = /^(<\/?)([a-zA-Z][\w-]*)([\s\S]*?)(\/?>)$/.exec(tag);
  if (!parts) return escapeHtml(tag);
  return (
    `<span class="spc-t-punc">${escapeHtml(parts[1] ?? "")}</span>` +
    `<span class="spc-t-tag">${escapeHtml(parts[2] ?? "")}</span>` +
    attrsHtml(parts[3] ?? "") +
    `<span class="spc-t-punc">${escapeHtml(parts[4] ?? "")}</span>`
  );
}

/**
 * A small hand-rolled tokenizer for the editor overlay — comments, tags,
 * attribute names and string values each get a colour. Not a linter: it only
 * colours text that is already well-formed, and leaves half-typed markup as
 * plain text so typing never flickers.
 */
function highlightHtml(src: string): string {
  const tokenRe = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^<>]*>/g;
  let out = "";
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(src)) !== null) {
    out += escapeHtml(src.slice(last, match.index));
    const token = match[0];
    out +=
      token.startsWith("<!--")
        ? `<span class="spc-t-com">${escapeHtml(token)}</span>`
        : tagHtml(token);
    last = match.index + token.length;
  }
  return out + escapeHtml(src.slice(last));
}

const INDENT = "  ";

/**
 * "Code" replaces the WYSIWYG canvas with a full-width editor of the page's
 * real HTML (see `sectionsHtml`). There is no live preview pane — the HTML
 * button is the preview: every keystroke flows up through `onChange` into the
 * page document, where the editor's existing dirty flag auto-saves it exactly
 * like a canvas edit, and HTML mode renders the stored markup until `onReset`.
 *
 * The editor itself is a transparent textarea layered over a highlighted
 * <pre> (same mono metrics, synced scroll): tags, attributes, strings and
 * comments get colours, Tab indents two spaces / Shift+Tab dedents, and the
 * caret keeps the brand colour.
 */
export function SalesCodeView({ html, sections, style, onChange, onReset }: Props) {
  const [copied, setCopied] = useState(false);
  const hlRef = useRef<HTMLPreElement>(null);

  const generated = useMemo(
    () => sectionsHtml(sections, style.iconSet),
    [sections, style.iconSet],
  );
  const source = html ?? generated;
  const highlighted = useMemo(() => highlightHtml(source), [source]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const el = event.currentTarget;
    const value = el.value;
    const start = el.selectionStart;
    const end = el.selectionEnd;

    if (event.shiftKey) {
      // Dedent: drop up to two leading spaces on the caret's line.
      const lineStart = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
      const head = value.slice(lineStart, start);
      const trimmed = head.replace(/^ {1,2}/, "");
      const removed = head.length - trimmed.length;
      if (removed === 0) return;
      onChange(value.slice(0, lineStart) + trimmed + value.slice(end));
      const caret = Math.max(lineStart, start - removed);
      // React commits the new value first; re-home the caret after it lands.
      requestAnimationFrame(() => {
        el.selectionStart = caret;
        el.selectionEnd = caret;
      });
      return;
    }

    onChange(value.slice(0, start) + INDENT + value.slice(end));
    const caret = start + INDENT.length;
    requestAnimationFrame(() => {
      el.selectionStart = caret;
      el.selectionEnd = caret;
    });
  }

  return (
    <div className="spc">
      <div className="spc__bar">
        <span className="spc__file">index.html</span>
        <span className="spc__hint">
          {html !== null
            ? "Edited — auto-saved, shown by the HTML button"
            : "Generated from the sections — typing replaces them"}
        </span>
        <div className="spc__actions">
          <button
            type="button"
            className={copied ? "spc__btn spc__btn--done" : "spc__btn"}
            onClick={async () => {
              await navigator.clipboard.writeText(source);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            className="spc__btn"
            disabled={html === null}
            title="Discard code edits and rebuild from the section canvas"
            onClick={onReset}
          >
            Reset
          </button>
        </div>
      </div>
      <div className="spc__wrap">
        <pre
          className="spc__hl"
          aria-hidden="true"
          ref={hlRef}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
        <textarea
          className="spc__area"
          value={source}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          // The Import tab's "Copy-paste" door lands here — the caret is
          // already where the paste goes.
          autoFocus
          aria-label="Page HTML source"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onScroll={(event) => {
            const el = event.currentTarget;
            if (hlRef.current) {
              hlRef.current.scrollTop = el.scrollTop;
              hlRef.current.scrollLeft = el.scrollLeft;
            }
          }}
        />
      </div>
    </div>
  );
}
