import type { Member } from "../../api/client";
import { approverLabel, type StepDraft } from "./StepBuilder";

/** The routing slip from the sign-in page, rendered from the template being edited. */
export function RoutePreview({ name, steps, members }: { name: string; steps: StepDraft[]; members: Member[] }) {
  return (
    <figure aria-label="Preview of the approval route" className="rounded-lg bg-ink p-5 text-paper">
      <figcaption className="text-sm text-paper/70">How a request will move</figcaption>
      <div className="mt-4 rounded-md bg-surface p-5 text-ink shadow-[0_24px_48px_-24px_#0008]">
        <p className="text-xs font-medium text-muted">New request</p>
        <p className="mt-1 leading-snug font-semibold">{name.trim() || "Untitled workflow"}</p>
        {steps.length === 0 ? (
          <p className="mt-5 text-sm text-muted">Add a step to see the route.</p>
        ) : (
          <ol className="mt-5">
            {steps.map((step, i) => (
              <li key={step.key} className="relative flex gap-3 pb-4 last:pb-0">
                {i < steps.length - 1 && <span aria-hidden className="absolute top-7 left-3.5 h-[calc(100%-1.5rem)] w-px bg-line" />}
                <span
                  aria-hidden
                  className="grid size-7 shrink-0 place-items-center rounded-full bg-paper text-xs font-semibold text-muted ring-1 ring-line"
                >
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{step.name.trim() || `Step ${i + 1}`}</p>
                  <p className="truncate text-sm text-muted">{approverLabel(step, members)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </figure>
  );
}
