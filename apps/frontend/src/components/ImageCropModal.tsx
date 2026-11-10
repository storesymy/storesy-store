import { Button, Icon } from "@storesy/ui";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * Image cropper — no library, just a measured stage, a transform and one
 * canvas pass on Apply. The user pans inside the frame and zooms until the
 * crop reads well; Apply renders the framed region and hands the encoded
 * blob back (WebP, JPEG fallback on old engines).
 *
 * The window (frame) takes the height:width of the DISPLAY BOX the crop will
 * live in — the section's media slot (wide 16:9, split 4:5, square 1:1) or
 * the product tile — measured when Change was clicked, so what gets framed is
 * exactly how the picture will show on the page. Without a measured box the
 * window follows the image's own shape, and stands at 1:1 until the image
 * reports its size. The default view sits slightly inside the picture
 * (ZOOM_DEFAULT), leaving room for the click-and-drag repositioning to bite
 * before the zoom slider is touched.
 */

/** Zoom range: 1 = image just covers the window, 4 = heavily cropped in. */
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
/**
 * Default zoom. At 1.0 the image exactly covers a same-ratio window — drag
 * would have nothing to move — so open slightly zoomed: there is always
 * headroom to click-and-drag the image before touching the slider.
 */
const ZOOM_DEFAULT = 1.2;
/** WebP quality for the exported crop. */
const CROP_QUALITY = 0.9;
/** Longest stage edge in CSS px — the square's current size (1:1 default). */
const STAGE_EDGE = 340;
/** Viewport share the stage may use when 340px would overflow a narrow screen. */
const STAGE_VIEWPORT = 0.72;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Everything the render needs from the current image + transform state. */
interface CropMetrics {
  /** Display px per natural px (fit-to-frame × zoom). */
  scale: number;
  /** Displayed image size. */
  width: number;
  height: number;
  /** Frame-relative position of the image's top-left corner. */
  left: number;
  top: number;
}

interface ImageCropModalProps {
  /** Source bitmap — the chosen file's object URL (or a photo URL/data URI). */
  src: string;
  /** Export size: the crop's longer edge in pixels (both edges when 1:1). */
  outputSize: number;
  onApply: (blob: Blob) => void;
  onCancel: () => void;
  /**
   * The on-page display box the crop will sit in (the slot or tile, measured
   * at pick time) — the window mirrors its ratio so the crop is framed the
   * way it will be shown. Falls back to the image's own shape when absent.
   */
  frameBox?: { width: number; height: number };
}

export function ImageCropModal({
  src,
  outputSize,
  onApply,
  onCancel,
  frameBox,
}: ImageCropModalProps) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  /** Export refused — a remote host that blocks canvas reads (tainted). */
  const [exportBlocked, setExportBlocked] = useState(false);
  /** Stage edge budget — the current size, re-read on resize. */
  const [edge, setEdge] = useState(() =>
    Math.min(STAGE_EDGE, typeof window === "undefined" ? STAGE_EDGE : window.innerWidth * STAGE_VIEWPORT),
  );
  /** The image's own ratio — the fallback when no display box was measured. */
  const [imageAspect, setImageAspect] = useState(1);
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  // Load the source once; the <img> inside the stage is the visual copy.
  // First attempt in CORS mode: when the host allows it the canvas stays
  // untainted and Apply can export. Hosts without the header fail that load,
  // so fall back to a plain load — still viewable, but such hosts also block
  // canvas export (Apply reports that instead of failing silently).
  useEffect(() => {
    if (!src) {
      setImg(null);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setExportBlocked(false);
    setImageAspect(1); // image shape unknown while the new source loads
    const load = (cors: boolean) => {
      const image = new Image();
      if (cors) image.crossOrigin = "anonymous";
      image.onload = () => {
        if (cancelled) return;
        setImg(image);
        setFailed(false);
        if (image.naturalWidth > 0) setImageAspect(image.naturalWidth / image.naturalHeight);
      };
      image.onerror = () => {
        if (cancelled) return;
        if (cors) load(false);
        else {
          setImg(null);
          setFailed(true);
        }
      };
      image.src = src;
    };
    load(true);
    return () => {
      cancelled = true;
    };
  }, [src]);

  // Stage size follows the window, so small screens crop just as well.
  useEffect(() => {
    const measure = () => setEdge(Math.min(STAGE_EDGE, window.innerWidth * STAGE_VIEWPORT));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Escape always cancels — the crop is optional, nothing is lost but the pick.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Window ratio: the measured display box first (WYSIWYG — crop the file
  // into the shape it will show in), else the image's own shape.
  const slotRatio =
    frameBox && frameBox.width > 0 && frameBox.height > 0
      ? frameBox.width / frameBox.height
      : null;
  const aspect = slotRatio ?? imageAspect;

  // Window box: the ratio above, longest edge at the current stage size.
  const frameW = aspect >= 1 ? edge : edge * aspect;
  const frameH = aspect >= 1 ? edge / aspect : edge;

  function metrics(): CropMetrics | null {
    if (!img) return null;
    // Fit scale: the image just covers the frame, then zoom magnifies.
    const fit = Math.max(frameW / img.naturalWidth, frameH / img.naturalHeight);
    const scale = fit * zoom;
    const width = img.naturalWidth * scale;
    const height = img.naturalHeight * scale;
    // Panning can never expose an edge of the image inside the frame.
    const maxX = Math.max(0, (width - frameW) / 2);
    const maxY = Math.max(0, (height - frameH) / 2);
    const x = clamp(offset.x, -maxX, maxX);
    const y = clamp(offset.y, -maxY, maxY);
    return {
      scale,
      width,
      height,
      left: (frameW - width) / 2 + x,
      top: (frameH - height) / 2 + y,
    };
  }
  const m = metrics();

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!m) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers (test drivers) have nothing to capture — drag still
      // works while the pointer stays over the stage.
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: m.left - (frameW - m.width) / 2,
      originY: m.top - (frameH - m.height) / 2,
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOffset({
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  function reset() {
    setZoom(ZOOM_DEFAULT);
    setOffset({ x: 0, y: 0 });
  }

  function apply() {
    if (!img || !m) return;
    setExportBlocked(false);
    // Export keeps the frame's ratio: outputSize is the longer edge.
    const outW = aspect >= 1 ? outputSize : Math.max(1, Math.round(outputSize * aspect));
    const outH = aspect >= 1 ? Math.max(1, Math.round(outputSize / aspect)) : outputSize;
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingQuality = "high";
    // Frame rect in natural-image coordinates → draw it out at the output size.
    const sourceX = -m.left / m.scale;
    const sourceY = -m.top / m.scale;
    const sourceW = frameW / m.scale;
    const sourceH = frameH / m.scale;
    ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, 0, outW, outH);
    // A remote host without CORS headers taints the canvas — toBlob then
    // throws a SecurityError. Report it instead of failing silently.
    try {
      canvas.toBlob(
        (blob) => {
          if (blob && blob.type === "image/webp") {
            onApply(blob);
            return;
          }
          // Browsers that can't encode WebP fall back to JPEG (or PNG if even
          // that is unavailable) — the flow never dead-ends on the encoder.
          try {
            canvas.toBlob(
              (fallback) => {
                if (fallback) onApply(fallback);
                else setExportBlocked(true);
              },
              "image/jpeg",
              CROP_QUALITY,
            );
          } catch {
            setExportBlocked(true);
          }
        },
        "image/webp",
        CROP_QUALITY,
      );
    } catch {
      setExportBlocked(true);
    }
  }

  return (
    <div
      className="pd-modal"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="pd-modal__panel" role="dialog" aria-modal="true" aria-label="Crop image">
        <header className="pd-modal__head">
          <h2>Crop image</h2>
          <button
            type="button"
            className="pd-modal__close"
            aria-label="Close"
            onClick={onCancel}
          >
            <Icon name="close" size={14} />
          </button>
        </header>
        <div className="pd-modal__body">
          <div className="crop__stageWrap">
            <div
              className="crop__stage"
              style={{ width: frameW, height: frameH }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {m && img ? (
                <img
                  className="crop__img"
                  src={src}
                  alt=""
                  draggable={false}
                  style={{ width: m.width, height: m.height, left: m.left, top: m.top }}
                />
              ) : null}
              {!img && !failed ? (
                <span className="crop__status" role="status">
                  Loading…
                </span>
              ) : null}
              {failed ? (
                <span className="crop__status crop__status--error">
                  Couldn’t read that image.
                </span>
              ) : null}
            </div>
          </div>
          <div className="crop__controls">
            <div className="crop__controlRow">
              <span className="crop__controlLabel">Zoom</span>
              <input
                className="crop__zoom"
                type="range"
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                step={0.01}
                value={zoom}
                disabled={!img}
                aria-label="Zoom"
                onChange={(event) => setZoom(Number(event.target.value))}
              />
              <button type="button" className="crop__reset" onClick={reset}>
                Reset
              </button>
            </div>
            <p className="crop__hint">
              Drag inside the window to reposition the image — the crop matches the frame it
              will live in.
            </p>
            {exportBlocked ? (
              <p className="crop__error" role="alert">
                Couldn’t export the crop — that host blocks image downloads (CORS). Cancel and pick
                another source.
              </p>
            ) : null}
          </div>
          <div className="pd-modal__actions">
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={apply} disabled={!img}>
              Apply crop
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
