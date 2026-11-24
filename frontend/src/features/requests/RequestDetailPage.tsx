import { ChevronLeft, ShieldAlert } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { ApiError, type RequestDetail, type TimelineEvent } from "../../api/client";
import { ConfirmDialog, useNotice } from "../../shared/ui/overlays";
import { Button, Initials, PageLoading, StateMessage } from "../../shared/ui/primitives";
import { RouteTracker, StatusBadge } from "./components";
import { RequestForm } from "./RequestForm";
import {
  formatAmount,
  useAddComment,
  useCancelRequest,
  useComments,
  useDecision,
  useDuplicateRequest,
  useRequest,
  useSubmitRequest,
  useTimeline,
} from "./queries";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function problem(error: unknown, fallback: string): string {
  return error instanceof ApiError ? (error.fieldError("comment") ?? error.problem.detail) : fallback;
}

export function RequestDetailPage({ editing = false }: { editing?: boolean }) {
  const { id = "" } = useParams();
  const request = useRequest(id);

  if (request.isPending) return <PageLoading label="Loading request" />;
  if (request.isError) {
    const notFound = request.error instanceof ApiError && request.error.status === 404;
    return (
      <>
        <BackLink />
        <StateMessage tone={notFound ? "neutral" : "error"} title={notFound ? "Request not found" : "This request didn't load"}>
          {notFound ? "It may not exist, or you don't have access to it." : "Reload the page to try again."}
        </StateMessage>
      </>
    );
  }
  const data = request.data;
  if (editing) {
    return data.permissions.can_edit ? (
      <RequestForm key={data.revision} draft={data} />
    ) : (
      <StateMessage title="This request can't be edited">Only the requester can edit, and only while it is a draft.</StateMessage>
    );
  }
  return <RequestView request={data} />;
}

function BackLink() {
  return (
    <Link to="/requests" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink">
      <ChevronLeft aria-hidden className="size-4" /> Requests
    </Link>
  );
}

function RequestView({ request }: { request: RequestDetail }) {
  const amount = formatAmount(request.amount, request.currency);
  const requester = request.requester.full_name || request.requester.email;
  // Kept here, not in the decision panel: after a lost race the panel may disappear on refresh.
  const [conflict, setConflict] = useState(false);
  return (
    <>
      <BackLink />
      <header className="mb-6 max-w-5xl">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={request.status} />
          <span className="text-sm text-muted">{request.template.name}</span>
        </div>
        <h1 className="mt-2 text-[2rem] leading-tight font-semibold tracking-tight">{request.title}</h1>
        <p className="mt-2 text-sm text-muted">
          Requested by <span className="font-medium text-ink">{requester}</span>
          {request.submitted_at ? `, submitted ${when.format(new Date(request.submitted_at))}` : ", not submitted yet"}
        </p>
        {amount && <p className="mt-3 text-2xl font-semibold">{amount}</p>}
        {request.description && <p className="mt-4 max-w-prose whitespace-pre-line text-[15px] leading-relaxed">{request.description}</p>}
      </header>

      <div className="grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-8">
          {conflict && (
            <p role="status" className="rounded-lg bg-pending-wash p-4 text-sm text-pending">
              <span className="font-semibold">Someone else decided this step first.</span> The request below shows its current
              state; your decision was not saved.
            </p>
          )}
          <Actions request={request} onConflict={() => setConflict(true)} />
          <RouteTracker request={request} />
          {request.status !== "draft" && <Comments request={request} />}
        </div>
        <Timeline id={request.id} />
      </div>
    </>
  );
}

function Actions({ request, onConflict }: { request: RequestDetail; onConflict: () => void }) {
  const notify = useNotice();
  const navigate = useNavigate();
  const submit = useSubmitRequest();
  const cancel = useCancelRequest();
  const duplicate = useDuplicateRequest();
  const [confirm, setConfirm] = useState<"submit" | "cancel" | null>(null);
  const [error, setError] = useState<string>();
  const p = request.permissions;

  async function run(kind: "submit" | "cancel") {
    setError(undefined);
    try {
      if (kind === "submit") await submit.mutateAsync({ id: request.id, revision: request.revision });
      else await cancel.mutateAsync(request.id);
      notify(kind === "submit" ? "Request submitted" : "Request cancelled");
      setConfirm(null);
    } catch (err) {
      setError(problem(err, "The request could not be updated."));
      if (err instanceof ApiError && err.status === 422) {
        const steps = err.problem.errors?.steps;
        if (Array.isArray(steps)) setError(steps.join(" "));
      }
    }
  }

  const hasActions = p.can_edit || p.can_submit || p.can_cancel || p.can_duplicate || p.decision;
  if (!hasActions) return null;
  return (
    <section aria-label="Actions" className="flex flex-col gap-4">
      {request.needs_admin && p.decision === "fallback" && (
        <div role="note" className="flex gap-3 rounded-lg bg-pending-wash p-4 text-sm text-pending">
          <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          <p>
            <span className="font-semibold">Nobody can decide this step right now.</span> The approver may have left or changed
            role. As an administrator you can decide it; your comment and the fact that it was an admin decision are recorded.
          </p>
        </div>
      )}
      {p.decision && <DecisionPanel request={request} fallback={p.decision === "fallback"} onConflict={onConflict} />}
      {(p.can_edit || p.can_submit || p.can_cancel || p.can_duplicate) && (
        <div className="flex flex-wrap gap-2">
          {p.can_submit && <Button onClick={() => setConfirm("submit")}>Submit for approval</Button>}
          {p.can_edit && <Button variant="secondary" onClick={() => navigate(`/requests/${request.id}/edit`)}>Edit draft</Button>}
          {p.can_duplicate && (
            <Button
              variant="secondary"
              busy={duplicate.isPending}
              onClick={async () => {
                const copy = await duplicate.mutateAsync(request.id);
                notify("Copied to a new draft");
                navigate(`/requests/${copy.id}`);
              }}
            >
              Duplicate as new draft
            </Button>
          )}
          {p.can_cancel && <Button variant="ghost" className="text-reject hover:bg-reject-wash" onClick={() => setConfirm("cancel")}>Cancel request</Button>}
        </div>
      )}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirm(null);
            setError(undefined);
          }
        }}
        title={confirm === "submit" ? "Submit for approval?" : "Cancel this request?"}
        description={
          confirm === "submit"
            ? "It will follow the current version of the workflow, starting with the first step. You won't be able to edit it afterwards."
            : "Open approval steps are closed and the request can't be reopened. You can duplicate it later."
        }
        confirmLabel={confirm === "submit" ? "Submit for approval" : "Cancel request"}
        tone={confirm === "cancel" ? "danger" : "primary"}
        busy={submit.isPending || cancel.isPending}
        error={error}
        onConfirm={() => void run(confirm!)}
      />
    </section>
  );
}

function DecisionPanel({ request, fallback, onConflict }: { request: RequestDetail; fallback: boolean; onConflict: () => void }) {
  const notify = useNotice();
  const decide = useDecision();
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string>();
  const step = request.current_step ?? 1;
  const task = request.tasks.find((t) => t.status === "open");

  async function onDecide(approve: boolean) {
    if ((!approve || fallback) && !comment.trim()) {
      setError(approve ? "Add a comment explaining the admin decision." : "Add a comment explaining the rejection.");
      return;
    }
    setError(undefined);
    try {
      await decide.mutateAsync({ id: request.id, step, approve, comment: comment.trim() });
      notify(approve ? `Step ${step} approved` : "Request rejected");
      setComment("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) onConflict();
      else setError(problem(err, "The decision could not be saved."));
    }
  }

  return (
    <section aria-labelledby="decision-heading" className="rounded-lg bg-surface p-5 ring-2 ring-signal/40 sm:p-6">
      <h2 id="decision-heading" className="text-lg font-semibold">Your decision on step {step}</h2>
      <p className="mt-1 text-sm text-muted">{task?.step_name}</p>
      <label htmlFor="decision-comment" className="mt-4 block text-sm font-medium">
        Comment {fallback ? "(required)" : <span className="font-normal text-muted">(required to reject)</span>}
      </label>
      <textarea
        id="decision-comment"
        rows={3}
        maxLength={2000}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "decision-error" : undefined}
        className="mt-1.5 w-full rounded-md bg-surface px-3 py-2 text-[15px] ring-1 ring-line outline-none ring-inset focus:ring-2 focus:ring-signal"
      />
      {error && <p id="decision-error" role="alert" className="mt-2 text-sm text-reject">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button busy={decide.isPending && decide.variables?.approve === true} disabled={decide.isPending} onClick={() => void onDecide(true)} className="bg-approve hover:bg-approve/90 disabled:bg-approve/60">
          Approve step {step}
        </Button>
        <Button variant="secondary" busy={decide.isPending && decide.variables?.approve === false} disabled={decide.isPending} onClick={() => void onDecide(false)} className="text-reject">
          Reject request
        </Button>
      </div>
    </section>
  );
}

function Comments({ request }: { request: RequestDetail }) {
  const comments = useComments(request.id);
  const add = useAddComment();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string>();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) {
      setError("Write a comment first.");
      return;
    }
    setError(undefined);
    try {
      await add.mutateAsync({ id: request.id, body: body.trim() });
      setBody("");
    } catch (err) {
      setError(err instanceof ApiError ? (err.fieldError("body") ?? err.problem.detail) : "The comment could not be posted.");
    }
  }

  return (
    <section aria-labelledby="comments-heading">
      <h2 id="comments-heading" className="text-lg font-semibold">Comments</h2>
      {comments.isPending ? (
        <PageLoading label="Loading comments" />
      ) : comments.isError ? (
        <p className="mt-2 text-sm text-reject">Comments didn't load.</p>
      ) : comments.data.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No comments yet.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {comments.data.map((c) => (
            <li key={c.id} className="flex gap-3">
              <Initials name={c.author.full_name || c.author.email} />
              <div className="min-w-0">
                <p className="text-sm">
                  <span className="font-semibold">{c.author.full_name || c.author.email}</span>{" "}
                  <span className="text-muted">{when.format(new Date(c.created_at))}</span>
                </p>
                <p className="mt-0.5 whitespace-pre-line text-[15px]">{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={onSubmit} noValidate className="mt-5">
        <label htmlFor="new-comment" className="sr-only">Add a comment</label>
        <textarea
          id="new-comment"
          rows={2}
          maxLength={2000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a comment"
          aria-invalid={error ? true : undefined}
          className="w-full rounded-md bg-surface px-3 py-2 text-[15px] ring-1 ring-line outline-none ring-inset focus:ring-2 focus:ring-signal"
        />
        {error && <p role="alert" className="mt-1 text-sm text-reject">{error}</p>}
        <Button type="submit" variant="secondary" busy={add.isPending} className="mt-2">Post comment</Button>
      </form>
    </section>
  );
}

const VERB_LABEL: Record<string, string> = {
  "request.created": "Created the draft",
  "request.updated": "Edited the draft",
  "request.submitted": "Submitted for approval",
  "task.approved": "Approved a step",
  "task.rejected": "Rejected a step",
  "request.approved": "Request approved",
  "request.rejected": "Request rejected",
  "request.cancelled": "Cancelled the request",
  "comment.added": "Commented",
};

function describe(event: TimelineEvent): string {
  const base = VERB_LABEL[event.verb] ?? event.verb;
  const data = event.data as Record<string, unknown>;
  if (event.verb.startsWith("task.") && data.step) {
    return `${event.verb === "task.approved" ? "Approved" : "Rejected"} step ${String(data.step)}${data.step_name ? `, ${String(data.step_name)}` : ""}${data.fallback ? " (admin decision)" : ""}`;
  }
  if (event.verb === "request.submitted" && data.version) return `${base} (workflow version ${String(data.version)})`;
  return base;
}

function Timeline({ id }: { id: string }) {
  const timeline = useTimeline(id);
  return (
    <aside aria-labelledby="timeline-heading" className="lg:sticky lg:top-8 lg:self-start">
      <h2 id="timeline-heading" className="text-lg font-semibold">Audit trail</h2>
      <p className="mt-1 text-sm text-muted">Every change to this request, in order. Entries can't be edited.</p>
      {timeline.isPending ? (
        <PageLoading label="Loading audit trail" />
      ) : timeline.isError ? (
        <p className="mt-2 text-sm text-reject">The audit trail didn't load.</p>
      ) : (
        <ol className="mt-4 border-l border-line">
          {timeline.data.map((e) => (
            <li key={e.id} className="relative pb-4 pl-4 last:pb-0">
              <span aria-hidden className="absolute top-1.5 -left-[4.5px] size-2 rounded-full bg-ink-soft" />
              <p className="text-sm font-medium">{describe(e)}</p>
              <p className="text-xs text-muted">
                {e.actor_email || "System"}, {when.format(new Date(e.created_at))}
              </p>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
