import { GitBranchPlus } from "lucide-react";
import { Link } from "react-router";

import { ApiError, type TemplateSummary } from "../../api/client";
import { PageLoading, StateMessage } from "../../shared/ui/primitives";
import { canManage, useOrganization } from "../orgs/organization";
import { CATEGORY_LABEL, useTemplates } from "./queries";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function Status({ template }: { template: TemplateSummary }) {
  if (template.published_version) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span className="rounded bg-approve-wash px-2 py-0.5 text-xs font-semibold text-approve">Published v{template.published_version}</span>
        {template.has_draft && <span className="rounded bg-pending-wash px-2 py-0.5 text-xs font-semibold text-pending">Unpublished changes</span>}
      </span>
    );
  }
  return <span className="rounded bg-pending-wash px-2 py-0.5 text-xs font-semibold text-pending">Draft</span>;
}

export function WorkflowsPage() {
  const { active } = useOrganization();
  const admin = canManage(active?.role);
  const templates = useTemplates();

  return (
    <>
      <header className="mb-8 flex max-w-4xl flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[2rem] leading-tight font-semibold tracking-tight">Workflows</h1>
          <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-muted">
            {admin
              ? "Each workflow defines who approves a kind of request, and in what order."
              : "The approval routes your requests will follow."}
          </p>
        </div>
        {admin && (
          <Link
            to="/workflows/new"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-signal px-4 text-sm font-semibold text-white hover:bg-signal-strong"
          >
            <GitBranchPlus aria-hidden className="size-4" /> New workflow
          </Link>
        )}
      </header>

      {templates.isPending ? (
        <PageLoading label="Loading workflows" />
      ) : templates.isError ? (
        <StateMessage tone="error" title="Workflows didn't load">
          {templates.error instanceof ApiError ? templates.error.problem.detail : "Reload the page to try again."}
        </StateMessage>
      ) : templates.data.length === 0 ? (
        <StateMessage
          title={admin ? "No workflows yet" : "No published workflows yet"}
          action={
            admin ? (
              <Link to="/workflows/new" className="text-sm font-semibold text-signal hover:text-signal-strong">
                Create the first workflow
              </Link>
            ) : undefined
          }
        >
          {admin
            ? "Start with the request your team approves most often, such as purchases over a set amount."
            : "An admin needs to publish a workflow before requests can be submitted."}
        </StateMessage>
      ) : (
        <ul className="max-w-4xl divide-y divide-line rounded-lg bg-surface ring-1 ring-line">
          {templates.data.map((t) => (
            <li key={t.id}>
              <Link
                to={`/workflows/${t.id}`}
                className="grid gap-x-6 gap-y-2 px-4 py-4 hover:bg-paper focus-visible:bg-paper sm:grid-cols-[minmax(0,1fr)_auto] sm:px-5"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2">
                    <span className="truncate font-semibold">{t.name}</span>
                    <span className="shrink-0 text-xs text-muted">{CATEGORY_LABEL[t.category]}</span>
                  </p>
                  {t.description && <p className="mt-0.5 truncate text-sm text-muted">{t.description}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted sm:justify-end">
                  <Status template={t} />
                  {t.published_version ? <span>{t.published_step_count} {t.published_step_count === 1 ? "step" : "steps"}</span> : null}
                  <span className="tabular-nums">Updated {dateFormat.format(new Date(t.updated_at))}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
