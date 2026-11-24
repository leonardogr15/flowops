import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import { X } from "lucide-react";
import { createContext, use, useCallback, useId, useState, type ReactNode, type SelectHTMLAttributes } from "react";

import { Button } from "./primitives";

/* ----------------------------------------------------------------------------- Modal */

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  role?: "dialog" | "alertdialog";
}

export function Modal({ open, onOpenChange, title, description, children, role = "dialog" }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content
          role={role}
          onOpenAutoFocus={(event) => {
            // Start on the first form field when there is one, not on the close button.
            const field = (event.currentTarget as HTMLElement).querySelector<HTMLElement>("input:not([disabled]), select, textarea");
            if (field) {
              event.preventDefault();
              field.focus();
            }
          }}
          className="fixed top-1/2 left-1/2 z-50 w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-surface p-6 shadow-2xl focus:outline-none"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
              {description && <Dialog.Description className="mt-1 text-sm text-muted">{description}</Dialog.Description>}
            </div>
            <Dialog.Close className="rounded p-1 text-muted hover:bg-paper" aria-label="Close">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <div className="mt-6">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface ConfirmProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  /** Extra fields shown above the buttons, for example a required reason. */
  children?: ReactNode;
}

/** Confirmation for consequential actions. The confirm button repeats the action's name. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, tone = "primary", busy, error, onConfirm, children }: ConfirmProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={description} role="alertdialog">
      {children}
      {error && (
        <p role="alert" className="mb-4 rounded-md bg-reject-wash px-3 py-2 text-sm text-reject">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Dialog.Close asChild>
          <Button type="button" variant="secondary">Cancel</Button>
        </Dialog.Close>
        <Button
          type="button"
          busy={busy}
          onClick={onConfirm}
          className={tone === "danger" ? "bg-reject hover:bg-reject/90 disabled:bg-reject/60" : undefined}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

/* ----------------------------------------------------------------------------- Select */

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hideLabel?: boolean;
  error?: string;
}

export function Select({ label, hideLabel, error, className, children, ...props }: SelectProps) {
  const id = useId();
  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className={clsx("text-sm font-medium", hideLabel && "sr-only")}>
        {label}
      </label>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={clsx(
          "h-10 rounded-md bg-surface px-2.5 text-sm text-ink ring-1 ring-inset outline-none focus:ring-2 disabled:bg-paper disabled:text-muted",
          error ? "ring-reject" : "ring-line focus:ring-signal",
        )}
        {...props}
      >
        {children}
      </select>
      {error && (
        <p id={`${id}-error`} className="text-sm text-reject">
          {error}
        </p>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------------- Notices */

interface Notice {
  id: number;
  text: string;
  tone: "success" | "error";
}

const NoticeContext = createContext<((text: string, tone?: Notice["tone"]) => void) | null>(null);

/**
 * Short confirmations ("Invitation sent") are announced politely and fade after 4 s. Errors are
 * announced as alerts and stay until dismissed, so nobody misses why something didn't work.
 */
export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const dismiss = useCallback((id: number) => setNotices((all) => all.filter((n) => n.id !== id)), []);
  const notify = useCallback(
    (text: string, tone: Notice["tone"] = "success") => {
      const id = Date.now() + Math.random();
      setNotices((all) => [...all.slice(-2), { id, text, tone }]);
      if (tone === "success") window.setTimeout(() => dismiss(id), 4000);
    },
    [dismiss],
  );
  const errors = notices.filter((n) => n.tone === "error");
  const confirmations = notices.filter((n) => n.tone === "success");
  return (
    <NoticeContext value={notify}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2">
        {errors.length > 0 && (
          // Rendered only while there are errors: an alert is announced when it appears.
          <div role="alert" className="flex flex-col items-end gap-2">
            {errors.map((n) => (
            <p key={n.id} className="pointer-events-auto flex items-start gap-3 rounded-md bg-reject px-4 py-2.5 text-sm font-medium text-white shadow-lg">
              <span>{n.text}</span>
              <button type="button" onClick={() => dismiss(n.id)} aria-label="Dismiss message" className="-mr-1 rounded p-0.5 hover:bg-white/15">
                <X aria-hidden className="size-4" />
              </button>
            </p>
            ))}
          </div>
        )}
        <div aria-live="polite" className="flex flex-col items-end gap-2">
          {confirmations.map((n) => (
            <p key={n.id} className="rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-paper shadow-lg">
              {n.text}
            </p>
          ))}
        </div>
      </div>
    </NoticeContext>
  );
}

export function useNotice() {
  const notify = use(NoticeContext);
  if (!notify) throw new Error("useNotice must be used inside <NoticeProvider>");
  return notify;
}
