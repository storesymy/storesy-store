import { createContext, useContext, useEffect, useRef } from "react";

/**
 * Whether the tree renders editing affordances. The editor canvas is the
 * default; read-only serialization (the stored documents) flips it off so
 * the same section renderers produce clean customer-facing markup.
 */
export const EditingContext = createContext(true);

/**
 * Static-document mode: the markup is serialized into the standalone page
 * served at `/<slug>`, where no JavaScript runs. Sections that normally
 * reveal content through interaction (FAQ answers, carousel slides) render
 * all of it up front instead — everything visible and crawlable.
 */
export const StaticContext = createContext(false);

interface EditableProps {
  value: string;
  onChange: (next: string) => void;
  /** Announced to screen readers — the field's role on the page. */
  ariaLabel: string;
  className?: string;
  /** Shown while the field is empty. */
  placeholder?: string;
}

/**
 * WYSIWYG text: an uncontrolled contenteditable whose DOM text is only synced
 * from state when it is NOT focused. Typing never re-renders the node (state is
 * committed on input but the effect skips focused elements), so the caret stays
 * put; on blur the value matches state and React's diff becomes a no-op.
 */
export function Editable({ value, onChange, ariaLabel, className, placeholder }: EditableProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const editing = useContext(EditingContext);

  useEffect(() => {
    const el = ref.current;
    if (!el || document.activeElement === el) return;
    if (el.textContent !== value) el.textContent = value;
  }, [value]);

  // Read-only contexts (the preview) render plain text — nothing to focus.
  if (!editing) return <span className={className}>{value}</span>;

  return (
    <span
      ref={ref}
      className={className}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      tabIndex={0}
      aria-label={ariaLabel}
      data-ph={value === "" ? (placeholder ?? "") : undefined}
      onInput={(event) => onChange(event.currentTarget.textContent ?? "")}
      onKeyDown={(event) => {
        // One line per field: Enter commits (blurs) instead of a new line.
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      onPaste={(event) => {
        // Plain text only — pasted markup must not leak into the canvas.
        event.preventDefault();
        const text = event.clipboardData.getData("text/plain").replace(/\s+/g, " ");
        document.execCommand("insertText", false, text);
      }}
    />
  );
}
