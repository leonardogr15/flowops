import { Check } from "lucide-react";

const STEPS = [
  { who: "Raj Approver", role: "Team lead", state: "Approved", time: "09:14" },
  { who: "Adam Admin", role: "Finance", state: "Reviewing", time: "now" },
  { who: "Olivia Owner", role: "Operations director", state: "Waiting", time: "" },
] as const;

/** Illustration for the sign-in screen: a request moving through its approval route. */
export function RoutingSlip() {
  return (
    <figure className="w-full max-w-sm">
      <div className="relative rounded-lg bg-surface p-6 pb-16 text-ink shadow-[0_1px_0_#0002,0_24px_48px_-24px_#0008]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-muted">Purchase request PR-1042</p>
            <p className="mt-1 text-lg leading-snug font-semibold">Standing desks for the support team</p>
          </div>
          <p className="text-lg font-semibold tabular-nums">$3,180</p>
        </div>

        <ol className="mt-6 space-y-0">
          {STEPS.map((step, i) => (
            <li key={step.who} className="relative flex gap-3 pb-5 last:pb-0">
              {i < STEPS.length - 1 && <span aria-hidden className="absolute top-7 left-3.5 h-[calc(100%-1.5rem)] w-px bg-line" />}
              <span
                aria-hidden
                className={
                  step.state === "Approved"
                    ? "grid size-7 shrink-0 place-items-center rounded-full bg-approve text-white"
                    : step.state === "Reviewing"
                      ? "grid size-7 shrink-0 place-items-center rounded-full bg-pending-wash text-xs font-semibold text-pending ring-2 ring-pending"
                      : "grid size-7 shrink-0 place-items-center rounded-full bg-paper text-xs font-semibold text-muted ring-1 ring-line"
                }
              >
                {step.state === "Approved" ? <Check className="size-4" strokeWidth={3} /> : i + 1}
              </span>
              <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{step.role}</p>
                  <p className="text-sm text-muted">{step.who}</p>
                </div>
                <p className="text-xs text-muted">
                  {step.state}
                  {step.time && step.time !== "now" ? ` at ${step.time}` : ""}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <span
          aria-hidden
          className="stamp pointer-events-none absolute right-6 bottom-5 rounded border-2 border-approve px-2 py-0.5 text-sm font-bold tracking-wide text-approve/80"
        >
          Step 1 approved
        </span>
      </div>
      <figcaption className="mt-4 text-sm text-paper/70">
        Every request follows its route. Each decision is recorded with who made it and when.
      </figcaption>
    </figure>
  );
}
