import { Icon, TextField } from "@storesy/ui";
import type { StoreType } from "@storesy/shared";
import { useState } from "react";
import type { CreateStoreInput } from "../lib/useStorefront";
import { STORE_TYPES, storeTypeOption } from "../lib/storeTypes";

interface CreateStorePanelProps {
  onCreate: (input: CreateStoreInput) => void;
}

/**
 * Two-step first-run flow: pick the storefront type (it decides everything
 * downstream), then name the store. Shown when the account has no store.
 */
export function CreateStorePanel({ onCreate }: CreateStorePanelProps) {
  const [step, setStep] = useState<1 | 2>(1);
  // Coming Soon is the default type — preselected so Continue is one click away.
  const [type, setType] = useState<StoreType | null>("coming-soon");
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  const chosen = type ? storeTypeOption(type) : null;

  function handleCreate() {
    if (!type) return;
    if (!name.trim()) {
      setError("Store name is required.");
      return;
    }
    onCreate({ type, name: name.trim(), tagline: tagline.trim(), handle: handle.trim() });
  }

  return (
    <div className="sf-create">
      <p className="sf-create__step">Step {step} of 2</p>

      {step === 1 ? (
        <>
          <h2 className="sf-create__title">Choose your storefront type</h2>
          <p className="sf-create__sub">
            This decides how customers experience your store. You can switch types later without
            losing anything.
          </p>

          <div className="sf-create__cards" role="group" aria-label="Storefront type">
            {STORE_TYPES.map((option) => {
              const active = type === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  className={active ? "sf-typeCard sf-typeCard--active" : "sf-typeCard"}
                  onClick={() => setType(option.id)}
                >
                  <span className="sf-typeCard__icon" aria-hidden="true">
                    <Icon name={option.icon} size={20} />
                  </span>
                  <span className="sf-typeCard__name">{option.label}</span>
                  <span className="sf-typeCard__desc">{option.description}</span>
                  <span className="sf-typeCard__best">Best for: {option.bestFor}</span>
                  <span className="sf-typeCard__check" aria-hidden="true">
                    <Icon name="check" size={13} />
                  </span>
                </button>
              );
            })}
          </div>

          <div className="sf-create__actions">
            <button
              type="button"
              className="ui-btn ui-btn--primary"
              disabled={!type}
              onClick={() => setStep(2)}
            >
              <span>Continue</span>
            </button>
          </div>
        </>
      ) : (
        <>
          <h2 className="sf-create__title">Name your store</h2>
          <p className="sf-create__sub">
            You can change these later — nothing here is permanent.
          </p>

          <div className="sf-create__summary">
            <span className="sf-typeCard__icon" aria-hidden="true">
              <Icon name={chosen?.icon ?? "stores"} size={20} />
            </span>
            <span className="sf-create__summaryText">
              <strong>{chosen?.label}</strong>
              <span>{chosen?.description}</span>
            </span>
            <button type="button" className="sf-create__change" onClick={() => setStep(1)}>
              Change
            </button>
          </div>

          <div className="sf-create__form">
            <TextField
              label="Store name"
              name="store-name"
              value={name}
              placeholder="Acme Supplies"
              error={error}
              onValueChange={(value) => {
                setName(value);
                if (error) setError(undefined);
              }}
            />
            <TextField
              label="Tagline"
              name="store-tagline"
              value={tagline}
              placeholder="Things that last."
              onValueChange={setTagline}
            />
            {type === "link-tree" ? (
              <TextField
                label="Handle (shown under your name)"
                name="store-handle"
                value={handle}
                placeholder="acmesupplies"
                onValueChange={setHandle}
              />
            ) : null}
          </div>

          <div className="sf-create__actions">
            <button type="button" className="ui-btn ui-btn--secondary" onClick={() => setStep(1)}>
              <span>Back</span>
            </button>
            <button type="button" className="ui-btn ui-btn--primary" onClick={handleCreate}>
              <span>Create store</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
