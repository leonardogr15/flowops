import clsx from "clsx";
import { Loader2 } from "lucide-react";
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";

import type { Role } from "../../api/client";

type Variant = "primary" | "secondary" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-signal text-white hover:bg-signal-strong disabled:bg-signal/60",
  secondary: "bg-surface text-ink ring-1 ring-inset ring-line hover:bg-paper",
  ghost: "text-ink hover:bg-ink/5",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", busy = false, className, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={clsx(
        "inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed",
        VARIANTS[variant],
        className,
      )}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...props}
    >
      {busy && <Loader2 aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  );
});

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export function Field({ label, error, hint, className, ...props }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={clsx(
          "h-11 rounded-md bg-surface px-3 text-[15px] text-ink ring-1 ring-inset outline-none transition-shadow placeholder:text-muted/70 focus:ring-2",
          error ? "ring-reject focus:ring-reject" : "ring-line focus:ring-signal",
        )}
        {...props}
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm text-reject">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const ROLE_STYLE: Record<Role, string> = {
  owner: "bg-ink text-paper",
  admin: "bg-signal-wash text-signal-strong",
  member: "bg-paper text-muted ring-1 ring-inset ring-line",
};

export function RoleBadge({ role }: { role: Role }) {
  const label = { owner: "Owner", admin: "Admin", member: "Member" }[role];
  return <span className={clsx("inline-flex rounded px-2 py-0.5 text-xs font-semibold", ROLE_STYLE[role])}>{label}</span>;
}

export function Initials({ name, className }: { name: string; className?: string }) {
  const letters =
    name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?";
  return (
    <span
      aria-hidden
      className={clsx("inline-grid size-8 shrink-0 place-items-center rounded-full bg-ink-soft text-xs font-semibold text-paper", className)}
    >
      {letters}
    </span>
  );
}

interface StateProps {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "error";
}

/** Empty, error and permission states share one quiet layout so pages stay consistent. */
export function StateMessage({ title, children, action, tone = "neutral" }: StateProps) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className="max-w-prose py-10">
      <h2 className={clsx("text-lg font-semibold", tone === "error" ? "text-reject" : "text-ink")}>{title}</h2>
      {children && <div className="mt-1.5 text-[15px] leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function PageLoading({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-10 text-muted">
      <Loader2 aria-hidden className="size-5 animate-spin" />
      <span>{label}</span>
    </div>
  );
}
