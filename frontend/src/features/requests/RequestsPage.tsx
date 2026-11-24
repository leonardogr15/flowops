import clsx from "clsx";
import { FilePlus2 } from "lucide-react";
import { Link, useSearchParams } from "react-router";

import { ApiError, type RequestStatus } from "../../api/client";
import { Button, PageLoading, StateMessage } from "../../shared/ui/primitives";
import { StatusBadge } from "./components";
import { formatAmount, STATUS_LABEL, useRequests } from "./queries";

const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const FILTERS: (RequestStatus | "")[] = ["", "draft", "in_review", "approved", "rejected", "cancelled"];

export function RequestsPage() {
  const [params, setParams] = useSearchParams();
  const scope = params.get("scope") === "all" ? "all" : "mine";
  const status = (FILTERS.includes(params.get("status") as RequestStatus) ? params.get("status") : "") as RequestStatus | "";
  const requests = useRequests(scope, status);

  function update(next: Record<string, string>) {
    const merged = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) merged.set(k, v);
      else merged.delete(k);
    }
    setParams(merged, { replace: true });
  }

  return (
    <>
      <header className="mb-6 flex max-w-5xl flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[2rem] leading-tight font-semibold tracking-tight">Requests</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">Purchases, expenses and access requests, and where each one stands.</p>
        </div>
        <Link
          to="/requests/new"
          className="inline-flex h-10 items-center gap-2 rounded-md bg-signal px-4 text-sm font-semibold text-white hover:bg-signal-strong"
        >
          <FilePlus2 aria-hidden className="size-4" /> New request
        </Link>
      </header>

      <div className="mb-5 flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-3">
        <div role="group" aria-label="Whose requests" className="inline-flex rounded-md bg-surface p-0.5 ring-1 ring-line">
          {(
            [
              ["mine", "Mine"],
              ["all", "All I can see"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={scope === value}
              onClick={() => update({ scope: value === "mine" ? "" : value })}
              className={clsx("rounded px-3 py-1.5 text-sm font-medium", scope === value ? "bg-ink text-paper" : "text-muted hover:text-ink")}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted">
          Status
          <select
            value={status}
            onChange={(e) => update({ status: e.target.value })}
            className="h-9 rounded-md bg-surface px-2 text-sm text-ink ring-1 ring-line ring-inset"
          >
            {FILTERS.map((f) => (
              <option key={f || "all"} value={f}>{f ? STATUS_LABEL[f] : "Any status"}</option>
            ))}
          </select>
        </label>
      </div>

      {requests.isPending ? (
        <PageLoading label="Loading requests" />
      ) : requests.isError ? (
        <StateMessage tone="error" title="Requests didn't load">
          {requests.error instanceof ApiError ? requests.error.problem.detail : "Reload the page to try again."}
        </StateMessage>
      ) : requests.data.pages[0]!.results.length === 0 ? (
        <StateMessage
          title={status ? `No ${STATUS_LABEL[status].toLowerCase()} requests` : scope === "mine" ? "You haven't created a request yet" : "Nothing to show yet"}
          action={<Link to="/requests/new" className="text-sm font-semibold text-signal hover:text-signal-strong">Create a request</Link>}
        >
          {scope === "mine" ? "Start from one of your organization's published workflows." : "Requests you can see will appear here."}
        </StateMessage>
      ) : (
        <ul className="max-w-5xl divide-y divide-line rounded-lg bg-surface ring-1 ring-line">
          {requests.data.pages.flatMap((page) => page.results).map((r) => (
            <li key={r.id}>
              <Link to={`/requests/${r.id}`} className="grid gap-x-6 gap-y-1.5 px-4 py-4 hover:bg-paper focus-visible:bg-paper sm:grid-cols-[minmax(0,1fr)_auto] sm:px-5">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{r.title}</p>
                  <p className="truncate text-sm text-muted">
                    {r.template.name}
                    {scope === "all" ? `, requested by ${r.requester.full_name || r.requester.email}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted sm:justify-end">
                  <StatusBadge status={r.status} />
                  {r.status === "in_review" && r.current_step && r.step_count ? <span>Step {r.current_step} of {r.step_count}</span> : null}
                  {formatAmount(r.amount, r.currency) && <span className="font-medium text-ink">{formatAmount(r.amount, r.currency)}</span>}
                  <span>{date.format(new Date(r.updated_at))}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {requests.hasNextPage && (
        <Button variant="secondary" className="mt-4" busy={requests.isFetchingNextPage} onClick={() => void requests.fetchNextPage()}>
          Show more requests
        </Button>
      )}
    </>
  );
}
