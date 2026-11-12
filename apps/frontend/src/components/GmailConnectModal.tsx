import { Button, Icon } from "@storesy/ui";
import { useEffect, useState } from "react";

interface Props {
  onClose: () => void;
  /**
   * Ask the API for the Google consent URL. Resolves with the URL the
   * browser is sent to; rejects with the API's reason (e.g. OAuth not
   * configured) which is shown inline.
   */
  onStart: () => Promise<{ url: string }>;
}

/**
 * The Gmail card's setup dialog: no credential fields, just the promise of
 * what Google sign-in grants and one button. The button spins while the
 * Worker mints the consent URL, then the browser leaves for Google — the
 * confirmation dialog picks the story up on the way back.
 */
export function GmailConnectModal({ onClose, onStart }: Props) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape" && !starting) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, starting]);

  async function handleStart() {
    setStarting(true);
    setError(undefined);
    try {
      const { url } = await onStart();
      // Full page navigation: Google's consent screen replaces this dialog,
      // and its callback returns to /integrations with the pending cookie.
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Google sign-in.");
      setStarting(false);
    }
  }

  return (
    <div className="pd-modal" role="presentation" onClick={starting ? undefined : onClose}>
      <div
        className="pd-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gmail-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="pd-modal__head">
          <h2 id="gmail-title">Connect Gmail</h2>
          <button
            type="button"
            className="pd-modal__close"
            aria-label="Close"
            onClick={onClose}
            disabled={starting}
          >
            <Icon name="close" size={15} />
          </button>
        </header>

        <div className="pd-modal__body">
          <p className="itg__hint">Email · gmail.com</p>
          <p className="itg-google__lead">
            Sign in with Google to let Storesy send order emails from your Gmail account.
          </p>
          <ul className="itg-google__list">
            <li>Storesy can send email as you — it cannot read your inbox.</li>
            <li>Your Google password is never shared with Storesy.</li>
            <li>Disconnect any time by deleting this integration.</li>
          </ul>

          {error ? (
            <p className="pd-modal__error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="pd-modal__actions">
            <Button variant="secondary" onClick={onClose} disabled={starting}>
              Cancel
            </Button>
            <Button className="itg-google__button" loading={starting} onClick={() => void handleStart()}>
              <span className="itg-google__g" aria-hidden="true">
                G
              </span>
              {starting ? "Opening Google…" : "Sign in with Google"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
