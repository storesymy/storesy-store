import type { GmailOAuthPending } from "@storesy/shared";
import { Button, TextField } from "@storesy/ui";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

/** Where the post-sign-in dialog is in its life. */
export type GmailConfirmStage = "loading" | "ready" | "error";

interface Props {
  stage: GmailConfirmStage;
  /** Set once the API has answered — the details the merchant confirms. */
  pending?: GmailOAuthPending;
  /** Set when the pending connection could not be read. */
  error?: string;
  /** Cancel / Close: discards the pending connection and closes. */
  onClose: () => void;
  /** Save: writes the integration row from the pending connection. */
  onSave: (name: string) => Promise<void>;
}

/**
 * The confirmation dialog after Google sign-in. Nothing secret is shown —
 * only the account address, what Storesy may do with it, and the label the
 * row will get. The integration row does not exist until Save.
 */
export function GmailConfirmModal({ stage, pending, error, onClose, onSave }: Props) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

  // Seed the suggested label once the details arrive.
  useEffect(() => {
    if (pending) setName(pending.suggestedName);
  }, [pending]);

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() === "") {
      setSaveError("Name is required.");
      return;
    }
    setSaving(true);
    setSaveError(undefined);
    try {
      await onSave(name.trim());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save the connection.");
      setSaving(false);
    }
  }

  return (
    <div className="pd-modal" role="presentation" onClick={saving ? undefined : onClose}>
      <div
        className="pd-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gmail-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="pd-modal__head">
          <h2 id="gmail-confirm-title">Confirm Gmail connection</h2>
          <button
            type="button"
            className="pd-modal__close"
            aria-label="Close"
            onClick={onClose}
            disabled={saving}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </header>

        {stage === "loading" ? (
          <div className="pd-modal__body itg-confirm__loading" role="status">
            <span className="itg-confirm__spinner" aria-hidden="true" />
            <p>Fetching Gmail details…</p>
          </div>
        ) : stage === "error" ? (
          <div className="pd-modal__body">
            <p className="pd-modal__error" role="alert">
              {error ?? "That Gmail connection could not be read."}
            </p>
            <div className="pd-modal__actions">
              <Button onClick={onClose}>Close</Button>
            </div>
          </div>
        ) : pending ? (
          <form className="pd-modal__body" onSubmit={handleSave} noValidate>
            <dl className="itg-confirm__list">
              <div className="itg-confirm__row">
                <dt>Gmail account</dt>
                <dd>{pending.email}</dd>
              </div>
              <div className="itg-confirm__row">
                <dt>Permission</dt>
                <dd>Send email as this account</dd>
              </div>
              <div className="itg-confirm__row">
                <dt>Inbox access</dt>
                <dd>None — Storesy cannot read your mail</dd>
              </div>
              <div className="itg-confirm__row">
                <dt>Token</dt>
                <dd>Stored encrypted, never shown</dd>
              </div>
            </dl>

            <TextField
              label="Name"
              name="gmail-name"
              value={name}
              onValueChange={(value) => {
                setName(value);
                if (saveError) setSaveError(undefined);
              }}
              placeholder="Gmail"
              error={saveError}
              autoFocus
            />

            <p className="itg-google__lead">
              Clicking Save stores this connection. Nothing is saved until then.
            </p>

            <div className="pd-modal__actions">
              <Button variant="secondary" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Save
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
