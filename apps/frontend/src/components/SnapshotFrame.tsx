import { useEffect, useMemo, useRef, useState } from "react";
import { withHeightProbe } from "../lib/importUrl";
import { withContentEdit } from "../lib/contentEdit";

/** Where the frame sits before the document reports its own height. */
const DEFAULT_HEIGHT = 720;
const HEIGHT_MIN = 160;
const HEIGHT_MAX = 20_000;

/**
 * A complete document mounted the only way it can be: a sandboxed iframe
 * whose srcdoc IS the stored document. Its own scripts run — carousels,
 * countdowns, sticky bars, a footer's `new Date().getFullYear()` — sealed in
 * an opaque origin with no access to this app's cookies, storage or API.
 *
 * An opaque-origin frame can't be measured from out here, so the document
 * carries an injected snippet that postMessages its scrollHeight;
 * `withHeightProbe` stamps one in when the document didn't bring its own.
 * Only messages whose `event.source` is THIS frame are believed.
 *
 * The srcdoc additionally carries the content-edit layer: the page's own text
 * is editable in place, and each settled edit posts the whole document back
 * through `onEdit`. Nothing about the frame's own rendering changes — the user
 * is typing on the real page.
 *
 * Because of that, `html` is NOT mirrored into the frame unconditionally.
 * Pushing a new srcdoc mid-session reloads the frame: the caret jumps away
 * 400ms after the last keystroke, scroll resets, and the page's own script
 * state (a countdown, a carousel's position) is lost. So the frame only takes
 * a document it didn't produce itself — an import landing over it, the Code
 * view saving over it, a Reset — while its own edits are skipped, since that
 * DOM already shows them.
 */
export function SnapshotFrame({
  html,
  className,
  onEdit,
}: {
  html: string;
  className?: string;
  onEdit?: (next: string) => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [rendered, setRendered] = useState(html);
  /** The last document this frame itself produced — already on screen. */
  const fromFrame = useRef<string | null>(null);

  useEffect(() => {
    if (html === fromFrame.current) return; // our own edit: the DOM is current
    setRendered(html);
  }, [html]);

  const srcDoc = useMemo(() => {
    const probed = withHeightProbe(rendered);
    // `withHeightProbe` no-ops on a document that already carries a probe
    // (every import does), so record whether this render owns one — the edit
    // layer must only strip what it put there.
    const ownsHeightProbe = probed !== rendered;
    return withContentEdit(probed, ownsHeightProbe);
  }, [rendered]);

  useEffect(() => {
    function onMessage(event: MessageEvent): void {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { storesy?: unknown; h?: unknown; html?: unknown } | null;
      if (data == null) return;
      if (data.storesy === "edit") {
        if (typeof data.html === "string") {
          fromFrame.current = data.html; // remember whose document this is
          onEdit?.(data.html);
        }
        return;
      }
      if (data.storesy !== "height" || typeof data.h !== "number" || !Number.isFinite(data.h)) {
        return;
      }
      setHeight(Math.min(Math.max(Math.round(data.h), HEIGHT_MIN), HEIGHT_MAX));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onEdit]);

  return (
    <iframe
      ref={frameRef}
      className={className ? `spf ${className}` : "spf"}
      title="Page preview"
      srcDoc={srcDoc}
      sandbox="allow-scripts allow-forms allow-popups allow-modals"
      style={{ height: `${height}px` }}
    />
  );
}
