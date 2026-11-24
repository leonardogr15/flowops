import clsx from "clsx";
import { Ban, Check, Clock, ShieldAlert, X } from "lucide-react";

import type { ApprovalTask, PendingStep, RequestDetail, RequestStatus } from "../../api/client";
import { ROLE_LABEL } from "../orgs/organization";
import { STATUS_LABEL } from "./queries";

const STATUS_STYLE: Record<RequestStatus, string> = {
  draft: "bg-paper text-muted ring-1 ring-inset ring-line",
  in_review: "bg-pending-wash text-pending",
  approved: "bg-approve-wash text-approve",
  rejected: "bg-reject-wash text-reject",
  cancelled: "bg-paper text-muted line-through decoration-muted/50",
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  return <span className={clsx("inline-flex rounded px-2 py-0.5 text-xs font-semibold", STATUS_STYLE[status])}>{STATUS_LABEL[status]}</span>;
}

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function approverOf(step: { approver_type: string; approver_user?: { full_name: string; email: string } | null; approver_role?: string }) {
  if (step.approver_type === "user") return step.approver_user ? step.approver_user.full_name || step.approver_user.email : "A specific person";
  const role = step.approver_role as keyof typeof ROLE_LABEL | "";
  return role ? `Any ${ROLE_LABEL[role].toLowerCase()} or above` : "Any member";
}

type RouteRow =
  | { kind: "task"; order: number; name: string; task: ApprovalTask }
  | { kind: "upcoming"; order: number; name: string; step: PendingStep };

function Marker({ row, current }: { row: RouteRow; current: boolean }) {
  const base = "relative z-10 grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold";
  if (row.kind === "task" && row.task.status === "approved") return <span className={clsx(base, "bg-approve text-white")}><Check aria-hidden className="size-4" strokeWidth={3} /></span>;
  if (row.kind === "task" && row.task.status === "rejected") return <span className={clsx(base, "bg-reject text-white")}><X aria-hidden className="size-4" strokeWidth={3} /></span>;
  if (row.kind === "task" && row.task.status === "cancelled") return <span className={clsx(base, "bg-paper text-muted ring-1 ring-line")}><Ban aria-hidden className="size-4" /></span>;
  if (current) return <span className={clsx(base, "bg-pending-wash text-pending ring-2 ring-pending")}>{row.order}</span>;
  return <span className={clsx(base, "bg-paper text-muted ring-1 ring-line")}>{row.order}</span>;
}

/** The approval route: decided steps, the step waiting now, and the steps still ahead. */
export function RouteTracker({ request }: { request: RequestDetail }) {
  const rows: RouteRow[] = [
    ...request.tasks.map((task) => ({ kind: "task" as const, order: task.step_order, name: task.step_name, task })),
    ...request.upcoming_steps.map((step) => ({ kind: "upcoming" as const, order: step.order, name: step.name, step })),
  ].sort((a, b) => a.order - b.order);

  return (
    <section aria-labelledby="route-heading" className="rounded-lg bg-surface p-5 ring-1 ring-line sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="route-heading" className="text-lg font-semibold">Approval route</h2>
        <p className="text-sm text-muted">
          {request.version ? `Workflow version ${request.version}` : "Uses the version published when you submit"}
        </p>
      </div>
      <ol className="mt-5">
        {rows.map((row, i) => {
          const current = row.kind === "task" && row.task.status === "open";
          return (
            <li key={`${row.kind}-${row.order}`} className="relative flex gap-4 pb-6 last:pb-0" aria-current={current ? "step" : undefined}>
              {i < rows.length - 1 && <span aria-hidden className="absolute top-9 left-[15px] h-[calc(100%-2.25rem)] w-px bg-line" />}
              <Marker row={row} current={current} />
              <div className="min-w-0 flex-1 pt-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <p className="font-semibold">
                    <span className="sr-only">Step {row.order}: </span>
                    {row.name}
                  </p>
                  <StepState row={row} />
                </div>
                <p className="text-sm text-muted">
                  {row.kind === "task" ? approverOf(row.task) : approverOf(row.step)}
                </p>
                {row.kind === "task" && row.task.decided_by && (
                  <p className="mt-1.5 text-sm">
                    {row.task.status === "approved" ? "Approved" : "Rejected"} by{" "}
                    <span className="font-medium">{row.task.decided_by.full_name || row.task.decided_by.email}</span>
                    {row.task.decided_at ? ` on ${when.format(new Date(row.task.decided_at))}` : ""}
                    {row.task.fallback && (
                      <span className="ml-2 inline-flex items-center gap-1 rounded bg-pending-wash px-1.5 py-0.5 text-xs font-semibold text-pending">
                        <ShieldAlert aria-hidden className="size-3.5" /> Admin decision
                      </span>
                    )}
                  </p>
                )}
                {row.kind === "task" && row.task.comment && (
                  <blockquote className="mt-2 border-l-2 border-line pl-3 text-sm text-muted">{row.task.comment}</blockquote>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function StepState({ row }: { row: RouteRow }) {
  if (row.kind === "upcoming") return <span className="text-xs text-muted">Not reached</span>;
  const labels = { open: "Waiting for decision", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled" } as const;
  return (
    <span className={clsx("inline-flex items-center gap-1 text-xs", row.task.status === "open" ? "font-semibold text-pending" : "text-muted")}>
      {row.task.status === "open" && <Clock aria-hidden className="size-3.5" />}
      {labels[row.task.status]}
    </span>
  );
}
