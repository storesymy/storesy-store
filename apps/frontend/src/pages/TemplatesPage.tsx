import type { EmailTemplate } from "@storesy/shared";
import { Button, Icon, Shell, TextAreaField, TextField } from "@storesy/ui";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { buildNav } from "../lib/nav";
import { relativeTime } from "../lib/salesPages";
import { useTheme } from "../lib/theme";

/**
 * Email Templates — the messages the store sends on its own. A gallery of
 * cards; one template today (the checkout's thank-you email). Edit opens the
 * live subject + message, placeholders and all; saving changes what buyers
 * receive on their next paid order.
 */
export function TemplatesPage() {
  const { user, loading, logout } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const [templates, setTemplates] = useState<EmailTemplate[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);

  // The template being edited, mirrored into the two fields.
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setLoadError(undefined);
    api
      .templates()
      .then((result) => {
        if (!cancelled) setTemplates(result.templates);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          navigate("/login", { replace: true });
          return;
        }
        setLoadError(error instanceof ApiError ? error.message : "Could not load email templates.");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, navigate]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } finally {
      setLoggingOut(false);
    }
  }

  function openEditor(template: EmailTemplate) {
    setEditing(template);
    setSubject(template.subject);
    setBody(template.body);
    setSaveError(undefined);
    setFieldErrors({});
    setNotice(undefined);
  }

  function closeEditor() {
    if (saving) return;
    setEditing(null);
    setSaveError(undefined);
    setFieldErrors({});
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;

    const nextFieldErrors: Record<string, string> = {};
    if (subject.trim() === "") nextFieldErrors.subject = "Subject is required";
    if (body.trim() === "") nextFieldErrors.body = "Message is required";
    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setSaveError("Check the highlighted fields");
      return;
    }

    setSaving(true);
    setSaveError(undefined);
    setFieldErrors({});
    try {
      const saved = await api.updateTemplate(editing.id, { subject, body });
      setTemplates((current) =>
        current ? current.map((item) => (item.id === saved.id ? saved : item)) : [saved],
      );
      setEditing(null);
      setNotice(`${saved.name} saved — new paid orders will use this wording.`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        navigate("/login", { replace: true });
        return;
      }
      setSaveError(error instanceof ApiError ? error.message : "Could not save the template.");
      setFieldErrors(error instanceof ApiError ? (error.fields ?? {}) : {});
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  const count = templates?.length ?? 0;

  return (
    <Shell
      userName={user.name}
      userEmail={user.email}
      userRole={user.role}
      brandIcon="/storesy-icon.png"
      theme={theme}
      onThemeToggle={toggleTheme}
      onLogout={handleLogout}
      loggingOut={loggingOut}
      nav={buildNav(location.pathname, user.role)}
      onNavigate={(href) => navigate(href)}
    >
      <div className="pd">
        <header className="pd__header">
          <div>
            <h1 className="pd__title">Email Templates</h1>
            <p className="pd__sub">
              {templates === null
                ? "Loading templates…"
                : `${count} ${count === 1 ? "template" : "templates"} · sent automatically by the store`}
            </p>
          </div>
        </header>

        {notice ? (
          <p className="tpl__notice" role="status">
            <Icon name="check" size={14} /> {notice}
          </p>
        ) : null}

        {loadError ? (
          <div className="pd__panel">
            <div className="pd__empty">
              <Icon name="email" size={22} className="pd__emptyIcon" />
              <p className="pd__emptyTitle">Could not load email templates</p>
              <p className="pd__emptyHint">{loadError}</p>
              <button type="button" className="pd__clear" onClick={() => setReloadKey((key) => key + 1)}>
                Try again
              </button>
            </div>
          </div>
        ) : (
          <div className="tpl__grid">
            {(templates ?? []).map((template) => (
              <article className="tpl__card" key={template.id}>
                <span className="tpl__icon" aria-hidden="true">
                  <Icon name="email" size={18} />
                </span>
                <div className="tpl__body">
                  <h2 className="tpl__name">{template.name}</h2>
                  <p className="tpl__desc">{template.description}</p>
                  <p className="tpl__meta">Edited {relativeTime(template.updatedAt)}</p>
                </div>
                <Button
                  className="tpl__edit"
                  variant="secondary"
                  onClick={() => openEditor(template)}
                >
                  Edit
                </Button>
              </article>
            ))}
          </div>
        )}
      </div>

      {editing ? (
        <div className="pd-modal" role="presentation" onClick={closeEditor}>
          <div
            className="pd-modal__panel tpl-modal__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tpl-edit-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="pd-modal__head">
              <h2 id="tpl-edit-title">Edit {editing.name}</h2>
              <button
                type="button"
                className="pd-modal__close"
                aria-label="Close"
                onClick={closeEditor}
                disabled={saving}
              >
                <Icon name="close" size={15} />
              </button>
            </header>

            <form className="pd-modal__body" onSubmit={handleSave} noValidate>
              <TextField
                label="Subject"
                name="tpl-subject"
                value={subject}
                onValueChange={(value) => {
                  setSubject(value);
                  if (fieldErrors.subject) setFieldErrors({});
                }}
                placeholder="Thank you for your order — {pageName}"
                error={fieldErrors.subject}
                maxLength={200}
                autoFocus
              />

              <TextAreaField
                label="Message"
                name="tpl-body"
                value={body}
                onValueChange={(value) => {
                  setBody(value);
                  if (fieldErrors.body) setFieldErrors({});
                }}
                error={fieldErrors.body}
                rows={18}
                spellCheck={false}
              />

              <p className="tpl__hint">
                Placeholders are filled from each order. Test orders get <code>[TEST]</code>{" "}
                added to the subject automatically; their notice comes from{" "}
                <code>{"{testNote}"}</code>.
              </p>

              <details className="tpl__tokens">
                <summary>Placeholders ({editing.placeholders.length})</summary>
                <dl className="tpl__tokenList">
                  {editing.placeholders.map((placeholder) => (
                    <div className="tpl__tokenRow" key={placeholder.token}>
                      <dt>
                        <code>{placeholder.token}</code>
                      </dt>
                      <dd>{placeholder.description}</dd>
                    </div>
                  ))}
                </dl>
              </details>

              {saveError ? (
                <p className="pd-modal__error" role="alert">
                  {saveError}
                </p>
              ) : null}

              <div className="pd-modal__actions">
                <Button variant="secondary" onClick={closeEditor} disabled={saving}>
                  Cancel
                </Button>
                <Button type="submit" loading={saving}>
                  Save changes
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </Shell>
  );
}
