import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";

import { api, ApiError, ensureCsrf, unwrap, type CurrentOrganization } from "../../api/client";
import { Button, Field, PageLoading, RoleBadge, StateMessage } from "../../shared/ui/primitives";
import { useInbox } from "../requests/queries";
import { canManage, membershipsKey, useOrganization } from "./organization";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function useCurrentOrganization() {
  const { active } = useOrganization();
  const slug = active?.organization.slug;
  return useQuery({
    queryKey: ["org", slug, "detail"],
    queryFn: () => unwrap(api.GET("/api/v1/org", { params: { header: { "X-Organization": slug ?? "" } } })),
    enabled: Boolean(slug),
  });
}

function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="mb-8 max-w-3xl">
      <h1 className="text-[2rem] leading-tight font-semibold tracking-tight">{title}</h1>
      {children && <p className="mt-2 text-[15px] leading-relaxed text-muted">{children}</p>}
    </header>
  );
}

function loadError(error: unknown) {
  return (
    <StateMessage tone="error" title="This page didn't load">
      {error instanceof ApiError ? error.problem.detail : "Check your connection and reload the page."}
    </StateMessage>
  );
}

export function OverviewPage() {
  const org = useCurrentOrganization();
  const waiting = useInbox().data?.count;
  if (org.isPending) return <PageLoading label="Loading organization" />;
  if (org.isError) return loadError(org.error);
  const data = org.data;

  return (
    <>
      <header className="mb-10 max-w-3xl">
        <p className="text-sm text-muted">Organization since {dateFormat.format(new Date(data.created_at))}</p>
        <h1 className="mt-1 text-display font-semibold">{data.name}</h1>
      </header>

      <dl className="grid max-w-3xl grid-cols-1 gap-px overflow-hidden rounded-lg bg-line ring-1 ring-line sm:grid-cols-3">
        <div className="bg-surface p-5">
          <dt className="text-sm text-muted">Your role</dt>
          <dd className="mt-2"><RoleBadge role={data.role} /></dd>
        </div>
        <div className="bg-surface p-5">
          <dt className="text-sm text-muted">Members</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums">{data.member_count}</dd>
        </div>
        <div className="bg-surface p-5">
          <dt className="text-sm text-muted">Workspace address</dt>
          <dd className="mt-2 truncate font-medium">{data.slug}</dd>
        </div>
      </dl>

      <section className="mt-12 max-w-3xl" aria-labelledby="work-heading">
        <h2 id="work-heading" className="text-lg font-semibold">Requests and approvals</h2>
        <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
          {waiting === undefined
            ? "Requests follow your published workflows step by step, and every decision is recorded."
            : waiting === 0
              ? "Nothing is waiting for your decision right now."
              : `${waiting} ${waiting === 1 ? "step is" : "steps are"} waiting for your decision.`}
        </p>
        <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold">
          <li><Link to="/inbox" className="text-signal hover:text-signal-strong">Open your inbox</Link></li>
          <li><Link to="/requests/new" className="text-signal hover:text-signal-strong">Create a request</Link></li>
          <li><Link to="/requests" className="text-signal hover:text-signal-strong">See your requests</Link></li>
        </ul>
      </section>

      <section className="mt-10 max-w-3xl" aria-labelledby="workflows-heading">
        <h2 id="workflows-heading" className="text-lg font-semibold">Workflows and people</h2>
        <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
          Workflows define who approves each kind of request and in what order.
          {canManage(data.role) ? " As an admin you can also review the organization's audit log." : ""}
        </p>
        <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold">
          <li>
            <Link to="/workflows" className="text-signal hover:text-signal-strong">
              {canManage(data.role) ? "Manage workflows" : "View workflows"}
            </Link>
          </li>
          <li><Link to="/members" className="text-signal hover:text-signal-strong">See who is in {data.name}</Link></li>
          {canManage(data.role) && (
            <li><Link to="/audit" className="text-signal hover:text-signal-strong">Open the audit log</Link></li>
          )}
        </ul>
      </section>
    </>
  );
}

export function SettingsPage() {
  const org = useCurrentOrganization();
  if (org.isPending) return <PageLoading label="Loading settings" />;
  if (org.isError) return loadError(org.error);

  if (!canManage(org.data.role)) {
    return (
      <>
        <PageHeader title="Settings" />
        <StateMessage title="Only admins can change organization settings">
          You're a member of {org.data.name}. Ask an owner or admin if the organization details need to change.
        </StateMessage>
      </>
    );
  }
  // Keyed by organization so switching organizations resets the form.
  return <SettingsForm key={org.data.id} organization={org.data} />;
}

function SettingsForm({ organization }: { organization: CurrentOrganization }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(organization.name);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const rename = useMutation({
    mutationFn: async (value: string) => {
      await ensureCsrf();
      return unwrap(
        api.PATCH("/api/v1/org", { body: { name: value }, params: { header: { "X-Organization": organization.slug } } }),
      );
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["org"] }),
        queryClient.invalidateQueries({ queryKey: membershipsKey }),
      ]);
      setSaved(true);
    },
    onError: (err) => setError(err instanceof ApiError ? (err.fieldError("name") ?? err.problem.detail) : "Could not save."),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    if (name.trim().length < 2) {
      setError("Use at least 2 characters.");
      return;
    }
    setError(undefined);
    rename.mutate(name.trim());
  }

  return (
    <>
      <PageHeader title="Settings">Details shown to everyone in the organization.</PageHeader>
      <form onSubmit={onSubmit} noValidate className="flex max-w-md flex-col gap-5">
        <Field
          label="Organization name"
          value={name}
          maxLength={120}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          error={error}
        />
        <Field label="Workspace address" value={organization.slug} readOnly disabled hint="The address can't be changed." />
        <div className="flex items-center gap-4">
          <Button type="submit" busy={rename.isPending} disabled={name.trim() === organization.name}>
            Save changes
          </Button>
          <p role="status" className="text-sm text-approve">{saved ? "Changes saved" : ""}</p>
        </div>
      </form>
    </>
  );
}

export function NoOrganizationPage({ onCreate }: { onCreate: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6">
      <StateMessage title="You're not in an organization yet" action={onCreate}>
        Ask your admin for an invitation, or create an organization to start routing requests.
      </StateMessage>
    </main>
  );
}
