import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";

import { api, ApiError, ensureCsrf, unwrap, type CurrentOrganization } from "../../api/client";
import { Button, Field, Initials, PageLoading, RoleBadge, StateMessage } from "../../shared/ui/primitives";
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

function useMembers() {
  const { active } = useOrganization();
  const slug = active?.organization.slug;
  return useQuery({
    queryKey: ["org", slug, "members"],
    queryFn: () =>
      unwrap(api.GET("/api/v1/org/members", { params: { header: { "X-Organization": slug ?? "" }, query: { page_size: 100 } } })),
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

      <section className="mt-12 max-w-3xl" aria-labelledby="workflows-heading">
        <h2 id="workflows-heading" className="text-lg font-semibold">Approval workflows</h2>
        <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
          No workflow templates yet. Templates define who approves each kind of request and in what order; they
          arrive in the next release of FlowOps.
        </p>
        <Link to="/members" className="mt-4 inline-block text-sm font-semibold text-signal hover:text-signal-strong">
          Review who is in {data.name}
        </Link>
      </section>
    </>
  );
}

export function MembersPage() {
  const { active } = useOrganization();
  const members = useMembers();

  return (
    <>
      <PageHeader title="Members">People who can submit and approve requests in this organization.</PageHeader>
      {members.isPending ? (
        <PageLoading label="Loading members" />
      ) : members.isError ? (
        loadError(members.error)
      ) : members.data.results.length === 0 ? (
        <StateMessage title="No members yet">Invite people to start routing requests.</StateMessage>
      ) : (
        <div className="max-w-4xl overflow-hidden rounded-lg bg-surface ring-1 ring-line">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Members of {active?.organization.name}</caption>
            <thead className="border-b border-line text-muted">
              <tr>
                <th scope="col" className="w-full px-4 py-3 font-medium sm:px-5">Name</th>
                <th scope="col" className="px-4 py-3 font-medium sm:px-5">Role</th>
                <th scope="col" className="hidden px-5 py-3 font-medium sm:table-cell">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {members.data.results.map((m) => (
                <tr key={m.id}>
                  <td className="max-w-0 px-4 py-3.5 sm:px-5">
                    <div className="flex items-center gap-3">
                      <Initials name={m.user.full_name || m.user.email} />
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{m.user.full_name || m.user.email}</p>
                        <p className="truncate text-muted">{m.user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 sm:px-5"><RoleBadge role={m.role} /></td>
                  <td className="hidden px-5 py-3.5 text-muted tabular-nums sm:table-cell">{dateFormat.format(new Date(m.created_at))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
