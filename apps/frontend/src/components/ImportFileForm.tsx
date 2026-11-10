import { Button, Icon } from "@storesy/ui";
import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { DOCUMENT_MAX_BYTES, importFileToHtml } from "../lib/importUrl";
import type { FileImportOutcome } from "../lib/importUrl";

interface Props {
  /** The Import Editor already carries HTML — importing replaces it. */
  replacing: boolean;
  /** Back out without importing — Cancel, ✕ or a click on the backdrop. */
  onClose: () => void;
  /** Name + finished document go to the caller (the editor owns the page). */
  onImported: (fileName: string, outcome: FileImportOutcome) => void;
}

/** The picker only admits documents the pipeline can make sense of. */
const HTML_FILE = /\.(html?|xhtml)$/i;

/**
 * The "Upload HTML file" dialog — the Import tab's second button. Choosing a
 * file IS the confirmation: the native picker hands it over, the shared
 * pipeline re-hydrates the markup and the caller closes the dialog with the
 * result. A wrong pick or an oversized file stays put with the message, so
 * trying another one is a single click.
 */
export function ImportFileForm({ replacing, onClose, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    // Clear before deciding — re-picking the same file must fire again.
    event.target.value = "";
    if (!file) return;
    setError(null);

    if (!HTML_FILE.test(file.name)) {
      setError("That isn’t an HTML document — pick a .html file.");
      return;
    }
    if (file.size > DOCUMENT_MAX_BYTES) {
      const mb = (file.size / 1_000_000).toFixed(1);
      setError(`That file is ${mb} MB — uploads cap at 3 MB.`);
      return;
    }

    setBusy(true);
    try {
      onImported(file.name, importFileToHtml(await file.text()));
    } catch {
      setError("Couldn’t read that file — try another one.");
      setBusy(false);
    }
    // Success path: the caller unmounts this dialog.
  }

  return (
    <div className="pd-modal" role="presentation" onMouseDown={onClose}>
      <div
        className="pd-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sp-import-file-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="pd-modal__head">
          <h2 id="sp-import-file-title">Upload HTML file</h2>
          <button
            type="button"
            className="pd-modal__close"
            aria-label="Close"
            onClick={onClose}
            disabled={busy}
          >
            <Icon name="close" size={15} />
          </button>
        </header>

        <div className="pd-modal__body">
          {replacing ? (
            <p className="imp__replacing" role="status">
              The Import Editor already has HTML — importing replaces it.
            </p>
          ) : null}
          <p className="imp__note">
            A local <strong>.html</strong> document, up to 3 MB. Pictures become placeholder art
            you swap with Change; the markup opens in the HTML preview.
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".html,.htm,.xhtml,text/html"
            hidden
            onChange={(event) => void handleFile(event)}
          />
          {error ? (
            <p className="pd-modal__error" role="alert">
              {error}
            </p>
          ) : null}
          {busy ? (
            <p className="imp__step" aria-live="polite">
              Importing the file…
            </p>
          ) : null}
          <div className="pd-modal__actions">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button loading={busy} onClick={() => inputRef.current?.click()}>
              Choose file
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
