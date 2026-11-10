import { Button, Icon, TextField } from "@storesy/ui";
import { useState } from "react";
import type { FormEvent } from "react";
import { importUrlToHtml, normalizeImportUrl } from "../lib/importUrl";
import type { ImportOutcome } from "../lib/importUrl";

interface Props {
  /** The Import Editor already carries HTML — importing replaces it. */
  replacing: boolean;
  /** Back out without importing — Cancel, ✕ or a click on the backdrop. */
  onClose: () => void;
  /** The finished document goes to the caller (the editor owns the page). */
  onImported: (outcome: ImportOutcome) => void;
}

/**
 * The "Import from URL" dialog — the Import tab's first button opens it.
 * Paste an address, confirm the rights box, watch the step narration while
 * the pipeline runs; the caller takes the finished HTML through `onImported`
 * and closes the dialog itself. On failure the dialog stays put with the
 * message, so a second attempt is one click.
 */
export function ImportUrlForm({ replacing, onClose, onImported }: Props) {
  const [url, setUrl] = useState("");
  const [rights, setRights] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = step !== null;

  async function handleImport(): Promise<void> {
    if (busy || !rights) return;
    setError(null);
    let target: string;
    try {
      target = normalizeImportUrl(url);
    } catch (cause) {
      setError((cause as Error).message);
      return;
    }
    setStep("Fetching the page…");
    try {
      onImported(await importUrlToHtml(target, setStep));
    } catch (cause) {
      setError((cause as Error)?.message || "Import failed — try another address.");
    }
    // The dialog outlives the run — always hand the button back its idle state.
    setStep(null);
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    void handleImport();
  }

  return (
    <div className="pd-modal" role="presentation" onMouseDown={onClose}>
      <div
        className="pd-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sp-import-url-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="pd-modal__head">
          <h2 id="sp-import-url-title">Import from URL</h2>
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

        <form className="pd-modal__body" onSubmit={handleSubmit} noValidate>
          <TextField
            label="URL"
            name="import-url"
            value={url}
            onValueChange={setUrl}
            placeholder="https://example.com/landing"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            autoFocus
          />
          {replacing ? (
            <p className="imp__replacing" role="status">
              The Import Editor already has HTML — importing replaces it.
            </p>
          ) : null}
          <label className="imp__check">
            <input
              type="checkbox"
              checked={rights}
              disabled={busy}
              onChange={(event) => setRights(event.target.checked)}
            />
            <span>I have the right to reuse this content.</span>
          </label>
          {error ? (
            <p className="pd-modal__error" role="alert">
              {error}
            </p>
          ) : null}
          {busy ? (
            <p className="imp__step" aria-live="polite">
              {step}
            </p>
          ) : null}
          <div className="pd-modal__actions">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!rights || url.trim().length === 0} loading={busy}>
              {busy ? "Importing…" : "Import Now"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
