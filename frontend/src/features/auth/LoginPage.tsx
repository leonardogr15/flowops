import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";

import { ApiError } from "../../api/client";
import { Button, Field } from "../../shared/ui/primitives";
import { RoutingSlip } from "./RoutingSlip";
import { useSession } from "./session";

interface Errors {
  email?: string;
  password?: string;
  form?: string;
}

function validate(email: string, password: string): Errors {
  const errors: Errors = {};
  if (!email.trim()) errors.email = "Enter your work email.";
  else if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = "Enter an email address like name@company.com.";
  if (!password) errors.password = "Enter your password.";
  return errors;
}

export function LoginPage() {
  const { user, signIn } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={from} replace />;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validate(email, password);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      navigate(from, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        setErrors({ form: "Too many sign-in attempts. Wait a minute, then try again." });
      } else if (error instanceof ApiError && error.status === 401) {
        setErrors({ form: "That email and password don't match an account." });
      } else if (error instanceof ApiError) {
        setErrors({ form: error.problem.detail });
      } else {
        setErrors({ form: "Sign-in failed. Try again." });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-20">
        <div className="w-full max-w-sm">
          <p className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <img src="/favicon.svg" alt="" className="size-7" />
            FlowOps
          </p>
          <h1 className="mt-12 text-3xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            Route purchases, expenses and access requests to the right approvers, with a record of every decision.
          </p>

          <form className="mt-8 flex flex-col gap-5" onSubmit={onSubmit} noValidate aria-describedby={errors.form ? "form-error" : undefined}>
            {errors.form && (
              <p id="form-error" role="alert" className="rounded-md bg-reject-wash px-3 py-2.5 text-sm text-reject">
                {errors.form}
              </p>
            )}
            <Field
              label="Work email"
              type="email"
              name="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={errors.email}
            />
            <Field
              label="Password"
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.password}
            />
            <Button type="submit" busy={busy} className="mt-1 h-11">
              Sign in
            </Button>
          </form>
          <p className="mt-6 text-sm text-muted">Accounts are created by invitation from your organization's admin.</p>
        </div>
      </main>

      <aside className="hidden items-center justify-center bg-ink px-12 lg:flex">
        <RoutingSlip />
      </aside>
    </div>
  );
}
