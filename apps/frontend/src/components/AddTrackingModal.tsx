import { Button, Icon } from "@storesy/ui";
import { useEffect, useState } from "react";
import { providerOf } from "@storesy/shared";
import type { IntegrationRecord } from "@storesy/shared";

interface Props {
  /** Tracking-category rows not yet on the page — the modal's options. */
  options: IntegrationRecord[];
  /** The chosen tracking was confirmed; the caller applies and closes. */
  onAdd: (uuid: string) => void;
  /** Dismissed without adding — backdrop, Cancel, ✕ and Escape. */
  onClose: () => void;
}

/**
 * "Add Tracking": pick one connected tracking integration (Google Tag
 * Manager, Meta Pixel, Tiktok Pixel …) from a select and add it to the
 * page's tracking list. Options exclude what's already added, so a
 * duplicate can't be chosen.
 */
export function AddTrackingModal({ options, onAdd, onClose }: Props) {
  const [choice, setChoice] = useState("");

  // Escape closes, like the backdrop and Cancel — no modal traps the panel.
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="pd-modal" role="presentation" onClick={onClose}>
      <div
        className="pd-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="atm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="pd-modal__head">
          <h2 id="atm-title">Add Tracking</h2>
          <button
            type="button"
            className="pd-modal__close"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="close" size={15} />
          </button>
        </header>

        <div className="pd-modal__body">
          {options.length === 0 ? (
            <p className="sp__note">Every connected tracking integration is already on this page.</p>
          ) : (
            <>
              <div className="ui-field">
                <label className="ui-field__label" htmlFor="atm-tracking">
                  Tracking
                </label>
                <select
                  id="atm-tracking"
                  className="ui-field__select"
                  value={choice}
                  onChange={(event) => setChoice(event.target.value)}
                >
                  <option value="">Choose a tracking integration…</option>
                  {options.map((row) => (
                    <option key={row.uuid} value={row.uuid}>
                      {row.name} · {providerOf(row.provider)?.label ?? row.provider}
                    </option>
                  ))}
                </select>
              </div>
              <div className="pd-modal__actions">
                <Button variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button disabled={choice === ""} onClick={() => onAdd(choice)}>
                  Add
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
