import { Icon } from "@storesy/ui";
import { useContext, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { ImageCropModal } from "./ImageCropModal";
import { EditingContext } from "./Editable";
import { isPlaceholderImage, placeholderId } from "../lib/salesPages";

/**
 * Export edge the crop is stored at (the crop's longer edge — the frame
 * keeps the image's ratio). Sales-page images live in the fake-data document
 * (localStorage), so 800 stays readable in every slot without ballooning the
 * saved data URI.
 */
const CROP_SIZE = 800;

interface Props {
  src: string;
  onChange: (next: string) => void;
  /** Layout class — aspect and rounding; the slot fills it. */
  className?: string;
  alt?: string;
}

/** A crop lands as a data URI — the fake-data phase has nowhere else to put it. */
function readAsDataUrl(blob: Blob, done: (dataUrl: string) => void): void {
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === "string" && reader.result) done(reader.result);
  };
  reader.readAsDataURL(blob);
}

/**
 * One image in the canvas. Preset art (`ph:<id>`) or a real URL — with a
 * hover "Change" button that opens the BROWSER'S FILE PICKER first: the
 * selected file drops into the image cropper, whose window mirrors this
 * slot's own box (wide 16:9, split 4:5 or square), and Apply stores the
 * crop as a data URI. Cancelling either step leaves the slot untouched.
 */
export function MediaSlot({ src, onChange, className, alt = "" }: Props) {
  const editable = useContext(EditingContext);
  const slotRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** The slot's display box — measured when Change opens the file picker. */
  const [frameBox, setFrameBox] = useState<{ width: number; height: number } | null>(null);
  const [cropperOpen, setCropperOpen] = useState(false);
  const [cropSrc, setCropSrc] = useState("");
  const [broken, setBroken] = useState(false);
  const showPreset = isPlaceholderImage(src) || broken;

  /** The file dialog's answer: a local image, straight into the cropper. */
  function onFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // reset so the same file can be chosen again
    if (!file || !file.type.startsWith("image/")) return;
    setCropSrc(URL.createObjectURL(file));
    setCropperOpen(true);
  }

  /** Close step: drop the object URL once nothing needs to read it anymore. */
  function releaseSource() {
    if (cropSrc.startsWith("blob:")) URL.revokeObjectURL(cropSrc);
    setCropSrc("");
  }

  return (
    <div ref={slotRef} className={className ? `sslot ${className}` : "sslot"}>
      {showPreset ? (
        <span className={`simg simg--${placeholderId(src)}`} aria-hidden="true">
          <Icon name="image" size={20} />
        </span>
      ) : (
        <img className="simg__img" src={src} alt={alt} onError={() => setBroken(true)} />
      )}
      {editable ? (
        <>
          <button
            type="button"
            className="sslot__edit"
            onClick={(event) => {
              event.stopPropagation();
              // Mirror this slot's box in the cropper window — the crop is
              // framed the way the picture will show on the page.
              const rect = slotRef.current?.getBoundingClientRect();
              setFrameBox(
                rect && rect.width > 0 && rect.height > 0
                  ? { width: rect.width, height: rect.height }
                  : null,
              );
              fileRef.current?.click();
            }}
          >
            <Icon name="image" size={13} />
            Change
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            aria-label="Choose image file"
            onChange={onFileChosen}
            hidden
          />
          {cropperOpen && cropSrc ? (
            <ImageCropModal
              src={cropSrc}
              outputSize={CROP_SIZE}
              frameBox={frameBox ?? undefined}
              onApply={(blob) => {
                readAsDataUrl(blob, (dataUrl) => {
                  onChange(dataUrl);
                  setBroken(false);
                  releaseSource();
                  setCropperOpen(false);
                });
              }}
              onCancel={() => {
                releaseSource();
                setCropperOpen(false);
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
