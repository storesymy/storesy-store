import { Button, Icon, SelectField, TextField } from "@storesy/ui";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { IntegrationProvider } from "../lib/integrations";

interface Props {
  /** The provider this dialog connects: its fields, hint and guide. */
  provider: IntegrationProvider;
  /** Dismissed without connecting — backdrop, Cancel, ✕ and Escape. */
  onClose: () => void;
  /**
   * Every required field filled — the values keyed by field name, for the
   * caller to apply however "connected" means in its view. May be async: a
   * rejection (e.g. the API's 422) is shown in the dialog and keeps it open;
   * the caller closes it only on success.
   */
  onConnect: (values: Record<string, string>) => void | Promise<void>;
}

/**
 * The "Connect {provider}" setup dialog, shared by any view that connects an
 * integration. It owns the form itself: the provider's credential fields and
 * their required-field errors, the guide that says where to find them, and
 * Escape-to-close. Validation runs here — the caller only ever sees a
 * completed form through `onConnect(values)`.
 */
export function ConnectModal({ provider, onClose, onConnect }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);

  // Escape closes, like the backdrop and Cancel — the dialog never traps.
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Select fields show an option the moment the dialog opens — seed it into
  // the values so what's visible is also what submits (the API requires it).
  useEffect(() => {
    setValues((prev) => {
      const seeded = { ...prev };
      for (const field of provider.fields) {
        if (field.options && seeded[field.name] === undefined) {
          seeded[field.name] = field.options[0] as string;
        }
      }
      return seeded;
    });
  }, [provider]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitError(undefined);

    // Every field the provider asks for is required client-side — the API
    // validates the same contract and its refusal lands in `submitError`.
    const missing = provider.fields.filter((field) => (values[field.name] ?? "").trim() === "");
    if (missing.length > 0) {
      setErrors(
        Object.fromEntries(missing.map((field) => [field.name, `${field.label} is required.`])),
      );
      return;
    }

    try {
      await onConnect(values);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Could not save.");
    }
  }

  return (
    <div className="pd-modal" role="presentation" onClick={onClose}>
      <div
        className="pd-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="pd-modal__head">
          <h2 id="cm-title">Connect {provider.label}</h2>
          <button
            type="button"
            className="pd-modal__close"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="close" size={15} />
          </button>
        </header>

        <form className="pd-modal__body" onSubmit={handleSubmit} noValidate>
          <p className="itg__hint">
            {provider.category} · {provider.domain}
          </p>
          {provider.fields.map((field) => {
            const onValueChange = (value: string) => {
              setValues((prev) => ({ ...prev, [field.name]: value }));
              if (errors[field.name]) {
                setErrors((prev) => ({ ...prev, [field.name]: undefined }));
              }
              if (submitError) setSubmitError(undefined);
            };
            return field.options ? (
              <SelectField
                key={field.name}
                label={field.label}
                name={field.name}
                options={field.options}
                value={values[field.name] ?? (field.options[0] as string)}
                error={errors[field.name]}
                onValueChange={onValueChange}
              />
            ) : (
              <TextField
                key={field.name}
                label={field.label}
                name={field.name}
                type={field.type ?? "text"}
                placeholder={field.placeholder}
                value={values[field.name] ?? ""}
                error={errors[field.name]}
                onValueChange={onValueChange}
              />
            );
          })}
          {provider.guide ? (
            <div className="itg-guide-block">
              <p className="itg-guide__title">{provider.guide.title}</p>
              <ol className="itg-guide">
                {provider.guide.steps.map((step, index) => (
                  <li key={index}>
                    {step.kind === "link" ? (
                      <>
                        {step.text}{" "}
                        <a href={step.url} target="_blank" rel="noopener noreferrer">
                          {step.url}
                        </a>
                      </>
                    ) : step.kind === "image" ? (
                      <>
                        {step.text}
                        <img
                          className="itg-guide__img"
                          src={step.image}
                          alt={step.alt ?? "Screenshot showing where to find the key"}
                          loading="lazy"
                        />
                      </>
                    ) : (
                      step.text
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
          {submitError ? (
            <p className="pd-modal__error" role="alert">
              {submitError}
            </p>
          ) : null}
          <div className="pd-modal__actions">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
