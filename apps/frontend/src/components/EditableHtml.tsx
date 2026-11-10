import { useEffect, useRef } from "react";

/**
 * A whole fragment made editable in place — the inline counterpart to the
 * framed page's edit layer. Used for hand-written markup on the canvas, which
 * has no iframe around it and so can be edited directly.
 *
 * Uncontrolled, exactly like `Editable`: the DOM is only synced from state
 * when it is NOT focused, so typing never re-renders the node and the caret
 * stays where the user left it. On blur the value already matches state and
 * React's diff is a no-op.
 */
export function EditableHtml({
  html,
  onEdit,
  className,
}: {
  html: string;
  onEdit: (next: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || document.activeElement === el) return;
    if (el.innerHTML !== html) el.innerHTML = html;
  }, [html]);

  return (
    <div
      ref={ref}
      className={className}
      contentEditable
      suppressContentEditableWarning
      // No rich-text paste: markup must not smuggle in a document.
      onPaste={(event) => {
        event.preventDefault();
        const text = event.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, text);
      }}
      onInput={(event) => onEdit(event.currentTarget.innerHTML)}
      onBlur={(event) => onEdit(event.currentTarget.innerHTML)}
    />
  );
}
