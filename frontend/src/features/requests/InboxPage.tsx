import { ShieldAlert } from "lucide-react";
import { Link } from "react-router";

import { ApiError } from "../../api/client";
import { PageLoading, StateMessage } from "../../shared/ui/primitives";
import { formatAmount, useInbox } from "./queries";

/** Sentence fragments stay in English like the rest of the UI (no mixed-locale phrases). */
function waiting(iso: string): string {
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (hours < 1) return "Waiting less than an hour";
  if (hours < 48) return `Waiting ${hours} hour${hours === 1 ? "" : "s"}`;
  return `Waiting ${Math.floor(hours / 24)} days`;
}

export function InboxPage() {
  const inbox = useInbox();
  return (
    <>
      <header className="mb-8 max-w-4xl">
        <h1 className="text-[2rem] leading-tight font-semibold tracking-tight">Inbox</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">Steps waiting for your decision, oldest first.</p>
      </header>
      {inbox.isPending ? (
        <PageLoading label="Loading your inbox" />
      ) : inbox.isError ? (
        <StateMessage tone="error" title="Your inbox didn't load">
          {inbox.error instanceof ApiError ? inbox.error.problem.detail : "Reload the page to try again."}
        </StateMessage>
      ) : inbox.data.results.length === 0 ? (
        <StateMessage title="Nothing waiting for you">When a request reaches a step you approve, it appears here.</StateMessage>
      ) : (
        <ul className="max-w-4xl divide-y divide-line rounded-lg bg-surface ring-1 ring-line">
          {inbox.data.results.map((item) => (
            <li key={item.id}>
              <Link to={`/requests/${item.request.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-1.5 px-4 py-4 hover:bg-paper focus-visible:bg-paper sm:px-5">
                <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                  <p className="truncate font-semibold">{item.request.title}</p>
                  <p className="truncate text-sm text-muted">
                    Step {item.step_order}, {item.step_name}. From {item.request.requester.full_name || item.request.requester.email}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                  {item.needs_admin && (
                    <span className="inline-flex items-center gap-1 rounded bg-pending-wash px-2 py-0.5 text-xs font-semibold text-pending">
                      <ShieldAlert aria-hidden className="size-3.5" /> Needs an administrator
                    </span>
                  )}
                  {formatAmount(item.request.amount, item.request.currency) && (
                    <span className="font-medium text-ink">{formatAmount(item.request.amount, item.request.currency)}</span>
                  )}
                  <span>{waiting(item.created_at)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {inbox.data && inbox.data.count > inbox.data.results.length && (
        <p role="status" className="mt-4 max-w-4xl text-sm text-muted">
          Showing the {inbox.data.results.length} oldest of {inbox.data.count} steps waiting for you. Decide these first and the rest
          will appear here.
        </p>
      )}
    </>
  );
}
