import { Button, Icon, TextAreaField, TextField } from "@storesy/ui";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  DEFAULT_EMAIL_SUBJECT,
  randomEmailBody,
} from "@storesy/shared";
import type {
  IntegrationRecord,
  IntegrationProvider,
  UpdateIntegrationInput,
} from "@storesy/shared";
import { formatAddedAt } from "../lib/integrations";

interface Props {
  /** The provider the instance belongs to (brand, category, website). */
  provider: IntegrationProvider;
  /** The stored instance whose details are shown (read shape — hints only). */
  entry: IntegrationRecord;
  /** Dismissed — backdrop, Close and Escape. */
  onClose: () => void;
  /** DELETE the instance; the caller closes on success. */
  onDelete: () => Promise<void>;
  /**
   * Fire the Test Email — the section's form passes its three values (the
   * button mode passes none and the server picks every default). Resolves
   * with the recipient the SERVER settled on; rejects with the provider's
   * reason to show inline.
   */
  onTestEmail: (
    overrides?: { recipient?: string; subject?: string; message?: string },
  ) => Promise<{ sent: boolean; to: string; subject: string }>;
  /** The signed-in user's email — the Recipient Email default. */
  sessionEmail: string;
  /**
   * PATCH ONE editable value: `{ name }` or `{ fields: { <configKey>: v } }`.
   * The caller refreshes its rows; the modal clears its inline state.
   */
  onSaveField: (patch: UpdateIntegrationInput) => Promise<void>;
  /**
   * OAuth providers only: restart the Google handshake for THIS row. The
   * browser leaves for Google; the caller never sees this resolve.
   */
  onReconnect?: () => Promise<void>;
}

interface RowProps {
  label: string;
  value: ReactNode;
  valueId?: string;
  /** Set when this row is editable inline — enables the pencil. */
  editableKey?: string;
  /** The editable string behind `value` (for the input's initial text). */
  editableValue?: string;
  /** Allowed values: renders a select instead of a text input (Host fields). */
  select?: readonly string[];
  /** Input type — `password` for secret fields (masked while typing). */
  type?: string;
  /** Hint shown in the empty input (catalogue hint, or the stored mask). */
  placeholder?: string;
  /** The row currently being edited ({ key }), or null. */
  editing: { key: string; value: string } | null;
  saving: boolean;
  editError: string | undefined;
  onStartEdit: (key: string, value: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditValue: (value: string) => void;
}

/**
 * One details row at module scope (an inner component would remount on every
 * keystroke and steal the caret): value + pencil when editable; while editing,
 * an input — or a select for Host-style fields — with ✓ (green, save) and ✕
 * (red, cancel).
 */
function Row({
  label,
  value,
  valueId,
  editableKey,
  editableValue,
  select,
  type,
  placeholder,
  editing,
  saving,
  editError,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditValue,
}: RowProps) {
  const isEditing = editableKey !== undefined && editing?.key === editableKey;
  return (
    <div className="itg-detail__row">
      <dt className="itg-detail__label">{label}</dt>
      <dd className="itg-detail__value" id={valueId}>
        {isEditing ? (
          <span className="itg-detail__edit">
            {select ? (
              <select
                className="itg-detail__input"
                aria-label={label}
                value={editing.value}
                disabled={saving}
                onChange={(event) => onEditValue(event.target.value)}
              >
                {select.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="itg-detail__input"
                aria-label={label}
                type={type ?? "text"}
                placeholder={placeholder}
                value={editing.value}
                autoFocus
                disabled={saving}
                onChange={(event) => onEditValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onSaveEdit();
                  if (event.key === "Escape") onCancelEdit();
                }}
              />
            )}
            <button
              type="button"
              className="itg-detail__iconBtn itg-detail__iconBtn--save"
              aria-label={`Save ${label}`}
              disabled={saving}
              onClick={onSaveEdit}
            >
              <Icon name="check" size={14} />
            </button>
            <button
              type="button"
              className="itg-detail__iconBtn itg-detail__iconBtn--cancel"
              aria-label={`Cancel ${label}`}
              disabled={saving}
              onClick={onCancelEdit}
            >
              <Icon name="close" size={14} />
            </button>
          </span>
        ) : (
          <span className="itg-detail__display">
            <span>{value}</span>
            {editableKey !== undefined ? (
              <button
                type="button"
                className="itg-detail__iconBtn itg-detail__iconBtn--edit"
                aria-label={`Edit ${label}`}
                onClick={() => onStartEdit(editableKey, editableValue ?? "")}
              >
                <Icon name="pencil" size={13} />
              </button>
            ) : null}
          </span>
        )}
        {isEditing && editError ? (
          <p className="itg-detail__error" role="alert">
            {editError}
          </p>
        ) : null}
      </dd>
    </div>
  );
}

/**
 * Details for one stored integration — with INLINE editing that mirrors the
 * provider's Connection/Edit form: the editable rows are EXACTLY that form's
 * fields (Name first, then every config and secret field in catalogue order),
 * each with a pencil → input (or select) + ✓ green save / ✕ red cancel.
 *
 * Secrets stay write-only in display (shown as their write-time hint) but are
 * editable like the connect form: the input starts EMPTY with the mask as its
 * placeholder, a typed value rotates the stored one, and saving it BLANK just
 * closes the editor — same "blank keeps it" rule as the connect-modal edit.
 *
 * Brand / Category / Website / Status / Added are facts, not fields: no
 * pencil. Save routes through `onSaveField` (a one-field PATCH); nothing
 * mutates until ✓.
 */
export function IntegrationDetailsModal({
  provider,
  entry,
  onClose,
  onDelete,
  onTestEmail,
  onSaveField,
  onReconnect,
  sessionEmail,
}: Props) {
  const [deleting, setDeleting] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | undefined>(undefined);
  const [testError, setTestError] = useState<string | undefined>(undefined);

  // Catalogue-driven Test Email: `fields` → a section in this modal;
  // capability without fields (Cloudflare) → the footer button; none → off.
  const testFields = provider.testEmail?.fields;
  const canTestEmail = provider.testEmail !== undefined;

  // Section defaults: your own address, the standard subject and body.
  const [testForm, setTestForm] = useState(() => ({
    recipient: sessionEmail,
    subject: DEFAULT_EMAIL_SUBJECT,
    message: randomEmailBody(),
  }));

  async function handleTestEmail(
    overrides?: { recipient?: string; subject?: string; message?: string },
  ) {
    if (overrides && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(overrides.recipient ?? "")) {
      setTestError("Enter a valid recipient email address.");
      setTestResult(undefined);
      return;
    }
    setTesting(true);
    setTestError(undefined);
    setTestResult(undefined);
    try {
      const result = await onTestEmail(overrides);
      setTestResult(`Test Email sent to ${result.to}`);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : "Could not send the test email.");
    } finally {
      setTesting(false);
    }
  }

  /** Which row is being edited right now, and its in-progress value. */
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | undefined>(undefined);

  // Escape closes, like the backdrop and Close — the dialog never traps.
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The Connection/Edit form's non-name fields, IN ITS ORDER — these are the
  // rows that carry pencils (secrets included; Brand/Website/Status don't).
  const fieldRows = provider.fields.filter((field) => field.role !== "name");

  function startEdit(key: string, value: string) {
    setEditing({ key, value });
    setEditError(undefined);
  }

  function cancelEdit() {
    setEditing(null);
    setEditError(undefined);
  }

  async function saveEdit() {
    if (!editing) return;
    const value = editing.value.trim();
    const field = provider.fields.find((entry) => entry.name === editing.key);
    if (value === "") {
      // Blank secret = "keep the stored one": nothing to write, just close.
      if (editing.key !== "name" && field?.role === "secret") {
        setEditing(null);
        setEditError(undefined);
        return;
      }
      setEditError("A value is required.");
      return;
    }
    setSaving(true);
    setEditError(undefined);
    try {
      await onSaveField(
        editing.key === "name" ? { name: value } : { fields: { [editing.key]: value } },
      );
      setEditing(null);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  const rowProps = {
    editing,
    saving,
    editError,
    onStartEdit: startEdit,
    onCancelEdit: cancelEdit,
    onSaveEdit: () => void saveEdit(),
    onEditValue: (value: string) =>
      setEditing((prev) => (prev ? { key: prev.key, value } : prev)),
  };

  async function handleReconnect() {
    if (!onReconnect) return;
    setReconnecting(true);
    setError(undefined);
    try {
      await onReconnect();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start reconnect.");
      setReconnecting(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setError(undefined);
    try {
      await onDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete.");
      setDeleting(false);
    }
  }

  return (
    <div className="pd-modal" role="presentation" onClick={onClose}>
      <div
        className="pd-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="idm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="pd-modal__body">
          <dl className="itg-detail">
            <Row
              {...rowProps}
              label="Name"
              value={entry.name}
              valueId="idm-title"
              editableKey="name"
              editableValue={entry.name}
            />
            <Row {...rowProps} label="Brand" value={provider.label} />
            {provider.auth === "google-oauth" ? (
              <>
                <Row
                  {...rowProps}
                  label="Gmail account"
                  value={entry.settings.username ?? "—"}
                />
                <Row
                  {...rowProps}
                  label="Connection"
                  value={
                    entry.settings.auth === "oauth"
                      ? "Google sign-in (send only)"
                      : "Legacy App Password"
                  }
                />
              </>
            ) : null}
            {fieldRows.map((field) => {
              const isSecret = field.role === "secret";
              const hint = entry.hints[field.name];
              return (
                <Row
                  {...rowProps}
                  key={field.name}
                  label={field.label}
                  value={
                    isSecret && hint ? (
                      <span className="itg-detail__key">{hint}</span>
                    ) : (
                      entry.settings[field.name] ?? "—"
                    )
                  }
                  editableKey={field.name}
                  editableValue={
                    isSecret
                      ? "" // write-only: start empty, mask shown as placeholder
                      : entry.settings[field.name] ??
                        (field.options ? (field.options[0] as string) : "")
                  }
                  select={field.options}
                  type={field.type}
                  placeholder={isSecret ? hint : field.placeholder}
                />
              );
            })}
            <Row {...rowProps} label="Added" value={formatAddedAt(entry.addedAt)} />
          </dl>
          {provider.auth === "google-oauth" && entry.settings.auth !== "oauth" ? (
            <p className="pd-modal__error" role="alert">
              This row predates Google sign-in and can no longer send email.
              Reconnect to replace its stored App Password.
            </p>
          ) : null}
          {testFields ? (
            <div className="itg-test">
              <p className="itg-test__title">Test Email</p>
              {testFields.map((field) =>
                field.type === "textarea" ? (
                  <TextAreaField
                    key={field.name}
                    label={field.label}
                    name={field.name}
                    value={testForm.message}
                    rows={6}
                    onValueChange={(value) => setTestForm((prev) => ({ ...prev, message: value }))}
                  />
                ) : (
                  <TextField
                    key={field.name}
                    label={field.label}
                    name={field.name}
                    type={field.type}
                    placeholder={field.placeholder}
                    value={field.name === "recipient" ? testForm.recipient : testForm.subject}
                    onValueChange={(value) =>
                      setTestForm((prev) => ({
                        ...prev,
                        [field.name]: value,
                      }))
                    }
                  />
                ),
              )}
              <div className="itg-test__actions">
                <Button disabled={testing || deleting} onClick={() => void handleTestEmail({ ...testForm })}>
                  {testing ? "Sending…" : "Send Test Email"}
                </Button>
                {testError ? (
                  <p className="pd-modal__error" role="alert">
                    {testError}
                  </p>
                ) : testResult ? (
                  <p className="pd-modal__ok" role="status">
                    {testResult}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <footer className="pd-modal__foot">
          {!canTestEmail ? null : testFields ? null : (error ?? testError) ? (
            <p className="pd-modal__error" role="alert">
              {error ?? testError}
            </p>
          ) : testResult ? (
            <p className="pd-modal__ok" role="status">
              {testResult}
            </p>
          ) : null}
          <div className="pd-modal__actions">
            {canTestEmail && !testFields ? (
              <Button
                variant="secondary"
                disabled={testing || deleting}
                onClick={() => void handleTestEmail()}
              >
                {testing ? "Sending…" : "Test Email"}
              </Button>
            ) : null}
            {onReconnect ? (
              <Button
                variant="secondary"
                disabled={testing || deleting || reconnecting}
                onClick={() => void handleReconnect()}
              >
                {reconnecting ? "Opening Google…" : "Reconnect"}
              </Button>
            ) : null}
            <Button variant="danger" disabled={deleting || testing || reconnecting} onClick={handleDelete}>
              Delete
            </Button>
            <Button variant="secondary" disabled={testing || reconnecting} onClick={onClose}>
              Close
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
