import { useInfiniteQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";

import { api, ApiError, unwrap, type AuditEvent } from "../../api/client";
import { Select } from "../../shared/ui/overlays";
import { Button, Field, PageLoading, StateMessage } from "../../shared/ui/primitives";
import { canManage, useOrganization } from "../orgs/organization";
import { useSlug } from "../requests/queries";

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });
const AREAS = [
  ["", "All activity"],
  ["request.", "Requests"],
  ["task.", "Approval decisions"],
  ["comment.", "Comments"],
  ["member.", "Members"],
  ["invitation.", "Invitations"],
  ["template.", "Workflows"],
] as const;

function summary(e: AuditEvent): string {
  const data = (e.data ?? {}) as Record<string, unknown>;
  const parts = Object.entries(data)
    .filter(([k, v]) => k !== "status" && v !== false && v !== null && v !== "")
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
  return parts.join("; ");
}

export function AuditPage() {
  const { active } = useOrganization();
  const slug = useSlug();
  const [filters, setFilters] = useState({ verb: "", actor: "" });
  const [draft, setDraft] = useState(filters);
  const events = useInfiniteQuery({
    queryKey: ["org", slug, "audit", filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET("/api/v1/org/audit-events", {
          params: {
            header: { "X-Organization": slug },
            query: {
              ...(filters.verb ? { verb: filters.verb } : {}),
              ...(filters.actor ? { actor: filters.actor } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
              page_size: 50,
            },
          },
        }),
      ),
    getNextPageParam: (last) => (last.next ? (new URL(last.next).searchParams.get("cursor") ?? undefined) : undefined),
    enabled: Boolean(slug) && canManage(active?.role),
  });

  if (!canManage(active?.role)) {
    return <StateMessage title="Only admins can see the audit log">Ask an owner or admin if you need the history of a change.</StateMessage>;
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters({ verb: draft.verb, actor: draft.actor.trim() });
  }

  const rows = events.data?.pages.flatMap((p) => p.results) ?? [];
  return (
    <>
      <header className="mb-6 max-w-5xl">
        <h1 className="text-[2rem] leading-tight font-semibold tracking-tight">Audit log</h1>
        <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-muted">
          Every request, decision, membership and workflow change in this organization. Entries are append-only:
          they can't be edited or deleted from the application or the database API.
        </p>
      </header>
      <form onSubmit={onSubmit} className="mb-5 flex max-w-5xl flex-wrap items-end gap-3">
        <Select label="Area" value={draft.verb} onChange={(e) => setDraft({ ...draft, verb: e.target.value })} className="w-48">
          {AREAS.map(([v, label]) => <option key={label} value={v}>{label}</option>)}
        </Select>
        <Field label="Person (email)" type="email" value={draft.actor} onChange={(e) => setDraft({ ...draft, actor: e.target.value })} className="w-64" />
        <Button type="submit" variant="secondary">Apply filters</Button>
      </form>
      {events.isPending ? (
        <PageLoading label="Loading audit log" />
      ) : events.isError ? (
        <StateMessage tone="error" title="The audit log didn't load">
          {events.error instanceof ApiError ? events.error.problem.detail : "Reload the page to try again."}
        </StateMessage>
      ) : rows.length === 0 ? (
        <StateMessage title="No matching activity">Try another area or person.</StateMessage>
      ) : (
        <div className="max-w-5xl overflow-x-auto rounded-lg bg-surface ring-1 ring-line">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <caption className="sr-only">Audit log</caption>
            <thead className="border-b border-line text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">When</th>
                <th scope="col" className="px-4 py-3 font-medium">Who</th>
                <th scope="col" className="px-4 py-3 font-medium">What</th>
                <th scope="col" className="px-4 py-3 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className="px-4 py-3 whitespace-nowrap text-muted">{when.format(new Date(e.created_at))}</td>
                  <td className="px-4 py-3">{e.actor_email || "System"}</td>
                  <td className="px-4 py-3 font-medium">
                    {e.target_type === "request" ? <Link to={`/requests/${e.target_id}`} className="text-signal hover:text-signal-strong">{e.verb}</Link> : e.verb}
                  </td>
                  <td className="px-4 py-3 text-muted">{summary(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {events.hasNextPage && (
        <Button variant="secondary" className="mt-4" busy={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>
          Load older entries
        </Button>
      )}
    </>
  );
}
