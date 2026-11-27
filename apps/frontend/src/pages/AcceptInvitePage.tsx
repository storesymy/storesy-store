import { MENU_ITEMS, acceptInvitationSchema } from "@storesy/shared";
import type { InvitationDetails } from "@storesy/shared";
import { Alert, Button, TextField } from "@storesy/ui";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";

type FieldErrors = Partial<Record<"password" | "confirmPassword", string>>;

export function AcceptInvitePage() {
  const { token = "" } = useParams();
  const { acceptInvite } = useAuth();
  const navigate = useNavigate();

  const [details, setDetails] = useState<InvitationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .invitation(token)
      .then((result) => {
        if (!cancelled) setDetails(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(
            error instanceof ApiError ? error.message : "Could not read this invitation.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    const parsed = acceptInvitationSchema.safeParse({ password, confirmPassword });
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if ((key === "password" || key === "confirmPassword") && !next[key]) {
          next[key] = issue.message;
        }
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await acceptInvite(token, parsed.data);
      navigate("/home", { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors((error.fields as FieldErrors | undefined) ?? {});
        setFormError(error.message);
      } else {
        setFormError("Could not accept the invitation.");
      }
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <AuthLayout title="Invitation" subtitle="Checking your link…" footer={null}>
        <p className="users__inviteLoading" role="status">
          Loading…
        </p>
      </AuthLayout>
    );
  }

  if (loadError || !details) {
    return (
      <AuthLayout
        title="Invitation unavailable"
        subtitle={loadError ?? "This invitation link is no longer valid."}
        footer={
          <span>
            Already have an account?{" "}
            <Link className="auth__link" to="/login">
              Log in
            </Link>
          </span>
        }
      >
        <p className="users__inviteHint">
          Ask an admin to send a fresh invitation from the User screen.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Accept invitation"
      subtitle={`${details.name}, review your access then set a password.`}
      footer={
        <span>
          Already have an account?{" "}
          <Link className="auth__link" to="/login">
            Log in
          </Link>
        </span>
      }
    >
      <div className="users__inviteDetails">
        <div className="users__inviteRow">
          <span>Name</span>
          <strong>{details.name}</strong>
        </div>
        <div className="users__inviteRow">
          <span>Email</span>
          <strong>{details.email}</strong>
        </div>
        <div className="users__inviteRow">
          <span>Group</span>
          <strong>{details.role === "admin" ? "Admin" : "Staff"}</strong>
        </div>
        <div className="users__inviteAccess">
          <span>Sidebar access</span>
          <ul>
            {details.menuAccess.map((key) => (
              <li key={key}>
                <input type="checkbox" checked readOnly disabled />{" "}
                {MENU_ITEMS.find((item) => item.key === key)?.label ?? key}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        {formError ? <Alert>{formError}</Alert> : null}
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onValueChange={(value) => {
            setPassword(value);
            setErrors((prev) => ({ ...prev, password: undefined }));
          }}
          error={errors.password}
          placeholder="At least 8 characters"
          required
        />
        <TextField
          label="Confirm password"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onValueChange={(value) => {
            setConfirmPassword(value);
            setErrors((prev) => ({ ...prev, confirmPassword: undefined }));
          }}
          error={errors.confirmPassword}
          placeholder="Type it again"
          required
        />
        <Button type="submit" loading={submitting}>
          Accept invitation &amp; log in
        </Button>
      </form>
    </AuthLayout>
  );
}
