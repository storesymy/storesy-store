import { signupSchema } from "@storesy/shared";
import type { SignupInput } from "@storesy/shared";
import { Alert, Button, TextField } from "@storesy/ui";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { AuthLayout } from "../components/AuthLayout";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth";

type FieldKey = keyof SignupInput;
type FieldErrors = Partial<Record<FieldKey, string>>;

export function SignUpPage() {
  const { user, loading, signup } = useAuth();
  const navigate = useNavigate();

  const [values, setValues] = useState<SignupInput>({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // null = checking, true = first-user slot free, false = invite-only.
  const [signupOpen, setSignupOpen] = useState<boolean | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .signupStatus()
      .then((status) => {
        if (cancelled) return;
        setSignupOpen(status.open);
        setStatusMessage(status.message);
      })
      .catch(() => {
        // Fail open for the form; the POST still enforces the policy.
        if (!cancelled) setSignupOpen(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loading && user) return <Navigate to="/home" replace />;

  const setField = (field: FieldKey) => (value: string) =>
    setValues((current) => ({ ...current, [field]: value }));

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsed = signupSchema.safeParse(values);
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as FieldKey | undefined;
        if (key && !(key in fieldErrors)) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});

    setSubmitting(true);
    try {
      await signup(parsed.data);
      navigate("/home", { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === "signup_closed") {
        setSignupOpen(false);
        setStatusMessage(error.message);
        return;
      }
      if (error instanceof ApiError) {
        setErrors((error.fields as FieldErrors | undefined) ?? {});
        if (!error.fields || Object.keys(error.fields).length === 0) {
          setFormError(error.message);
        }
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (signupOpen === null) {
    return (
      <AuthLayout
        title="Create your account"
        subtitle="Checking sign-up availability…"
        footer={null}
      >
        <p className="auth__invite" role="status">
          Checking sign-up availability…
        </p>
      </AuthLayout>
    );
  }

  if (!signupOpen) {
    return (
      <AuthLayout
        title="Sign-up is invite-only"
        subtitle="This store is already set up."
        footer={
          <span>
            Already have an account?{" "}
            <Link className="auth__link" to="/login">
              Log in
            </Link>
          </span>
        }
      >
        <p className="auth__invite" role="status">
          {statusMessage ?? "Please get invites from admin"}
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Start selling with Storesy in minutes."
      footer={
        <span>
          Already have an account?{" "}
          <Link className="auth__link" to="/login">
            Log in
          </Link>
        </span>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        {formError ? <Alert>{formError}</Alert> : null}
        <TextField
          label="Name"
          name="name"
          autoComplete="name"
          placeholder="Ada Lovelace"
          value={values.name}
          onValueChange={setField("name")}
          error={errors.name}
          required
        />
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@store.com"
          value={values.email}
          onValueChange={setField("email")}
          error={errors.email}
          required
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={values.password}
          onValueChange={setField("password")}
          error={errors.password}
          required
        />
        <Button type="submit" loading={submitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
