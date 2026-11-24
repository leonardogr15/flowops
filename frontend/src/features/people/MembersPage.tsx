import { Check, Copy, MailPlus, UserMinus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";

import { ApiError, type InvitableRole, type IssuedInvitation, type Member, type Role } from "../../api/client";
import { ConfirmDialog, Modal, Select, useNotice } from "../../shared/ui/overlays";
import { Button, Field, Initials, PageLoading, RoleBadge, StateMessage } from "../../shared/ui/primitives";
import { useSession } from "../auth/session";
import { ROLE_LABEL, canManage, useOrganization } from "../orgs/organization";
import { useChangeRole, useInvitations, useInvite, useMembers, useRemoveMember, useRevokeInvitation } from "./queries";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function expiresIn(iso: string): string {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return days <= 0 ? "expires today" : `expires ${relative.format(days, "day")}`;
}

function problemText(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.problem.detail : fallback;
}

/** Roles the current user may assign to someone, mirroring the server rules. */
function assignableRoles(actor: Role): Role[] {
  return actor === "owner" ? ["owner", "admin", "member"] : ["admin", "member"];
}

function canEditMember(actor: Role, target: Member): boolean {
  if (!canManage(actor)) return false;
  return target.role !== "owner" || actor === "owner";
}

export function MembersPage() {
  const { active } = useOrganization();
  const { user } = useSession();
  const actorRole = active?.role ?? "member";
  const manager = canManage(actorRole);
  const members = useMembers();
  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <>
      <header className="mb-8 flex max-w-4xl flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[2rem] leading-tight font-semibold tracking-tight">Members</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            People who can submit and approve requests in this organization.
          </p>
        </div>
        {manager && (
          <Button onClick={() => setInviteOpen(true)}>
            <MailPlus aria-hidden className="size-4" /> Invite people
          </Button>
        )}
      </header>

      {members.isPending ? (
        <PageLoading label="Loading members" />
      ) : members.isError ? (
        <StateMessage tone="error" title="Members didn't load">{problemText(members.error, "Reload the page to try again.")}</StateMessage>
      ) : (
        <div className="max-w-4xl overflow-hidden rounded-lg bg-surface ring-1 ring-line">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Members of {active?.organization.name}</caption>
            <thead className="border-b border-line text-muted">
              <tr>
                <th scope="col" className="w-full px-4 py-3 font-medium sm:px-5">Name</th>
                <th scope="col" className="px-4 py-3 font-medium sm:px-5">Role</th>
                <th scope="col" className="hidden px-5 py-3 font-medium md:table-cell">Joined</th>
                <th scope="col" className="px-4 py-3 sm:px-5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {members.data.pages.flatMap((page) => page.results).map((m) => (
                <MemberRow key={m.id} member={m} actorRole={actorRole} isSelf={m.user.id === user?.id} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {members.hasNextPage && (
        <Button variant="secondary" className="mt-4" busy={members.isFetchingNextPage} onClick={() => void members.fetchNextPage()}>
          Show more members
        </Button>
      )}

      {manager && <PendingInvitations />}
      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} actorRole={actorRole} />
    </>
  );
}

function MemberRow({ member, actorRole, isSelf }: { member: Member; actorRole: Role; isSelf: boolean }) {
  const notify = useNotice();
  const navigate = useNavigate();
  const changeRole = useChangeRole();
  const remove = useRemoveMember();
  const [confirming, setConfirming] = useState(false);
  const name = member.user.full_name || member.user.email;
  const editable = canEditMember(actorRole, member);
  const removable = isSelf || editable;

  async function onRoleChange(role: Role) {
    try {
      await changeRole.mutateAsync({ id: member.id, role });
      notify(`${name} is now ${ROLE_LABEL[role].toLowerCase()}`);
    } catch (error) {
      notify(problemText(error, "The role could not be changed."), "error");
    }
  }

  async function onRemove() {
    try {
      await remove.mutateAsync(member.id);
      setConfirming(false);
      if (isSelf) {
        notify("You left the organization");
        navigate("/overview", { replace: true });
      } else {
        notify(`${name} was removed`);
      }
    } catch {
      /* error shown in the dialog */
    }
  }

  return (
    <tr>
      <td className="max-w-0 px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-3">
          <Initials name={name} />
          <div className="min-w-0">
            <p className="truncate font-semibold">
              {name}
              {isSelf && <span className="ml-2 text-xs font-normal text-muted">You</span>}
            </p>
            <p className="truncate text-muted">{member.user.email}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3.5 sm:px-5">
        {editable ? (
          <Select
            label={`Role of ${name}`}
            hideLabel
            value={member.role}
            disabled={changeRole.isPending}
            onChange={(e) => void onRoleChange(e.target.value as Role)}
            className="w-32"
          >
            {assignableRoles(actorRole).map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </Select>
        ) : (
          <RoleBadge role={member.role} />
        )}
      </td>
      <td className="hidden px-5 py-3.5 whitespace-nowrap text-muted tabular-nums md:table-cell">{dateFormat.format(new Date(member.created_at))}</td>
      <td className="px-4 py-3.5 text-right sm:px-5">
        {removable && (
          <button
            onClick={() => setConfirming(true)}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1.5 text-sm font-medium text-muted hover:bg-reject-wash hover:text-reject"
            aria-label={isSelf ? "Leave organization" : `Remove ${name}`}
          >
            <UserMinus aria-hidden className="size-4" />
            <span className="hidden sm:inline">{isSelf ? "Leave" : "Remove"}</span>
          </button>
        )}
        <ConfirmDialog
          open={confirming}
          onOpenChange={(open) => {
            setConfirming(open);
            if (!open) remove.reset();
          }}
          title={isSelf ? "Leave this organization?" : `Remove ${name}?`}
          description={
            isSelf
              ? "You'll lose access to its requests and workflows. An admin can invite you again."
              : `${name} will lose access to this organization's requests and workflows.`
          }
          confirmLabel={isSelf ? "Leave organization" : "Remove member"}
          tone="danger"
          busy={remove.isPending}
          error={remove.isError ? problemText(remove.error, "The member could not be removed.") : undefined}
          onConfirm={() => void onRemove()}
        />
      </td>
    </tr>
  );
}

function PendingInvitations() {
  const invitations = useInvitations(true);
  const revoke = useRevokeInvitation();
  const notify = useNotice();

  if (invitations.isPending || invitations.isError || invitations.data.length === 0) return null;
  return (
    <section className="mt-10 max-w-4xl" aria-labelledby="pending-heading">
      <h2 id="pending-heading" className="text-lg font-semibold">Pending invitations</h2>
      <ul className="mt-3 divide-y divide-line rounded-lg bg-surface ring-1 ring-line">
        {invitations.data.map((inv) => (
          <li key={inv.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:px-5">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{inv.email}</p>
              <p className="text-sm text-muted">
                Invited as {ROLE_LABEL[inv.role as Role].toLowerCase()}
                {inv.invited_by ? ` by ${inv.invited_by}` : ""}, {expiresIn(inv.expires_at)}
              </p>
            </div>
            <Button
              variant="ghost"
              className="h-9 text-muted hover:text-reject"
              busy={revoke.isPending && revoke.variables === inv.id}
              onClick={async () => {
                try {
                  await revoke.mutateAsync(inv.id);
                  notify(`Invitation for ${inv.email} revoked`);
                } catch (error) {
                  notify(problemText(error, "The invitation could not be revoked."), "error");
                }
              }}
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function InviteDialog({ open, onOpenChange, actorRole }: { open: boolean; onOpenChange: (o: boolean) => void; actorRole: Role }) {
  const invite = useInvite();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("member");
  const [error, setError] = useState<string>();
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const [copied, setCopied] = useState(false);

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setEmail("");
      setRole("member");
      setError(undefined);
      setIssued(null);
      setCopied(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Enter an email address like name@company.com.");
      return;
    }
    setError(undefined);
    try {
      setIssued(await invite.mutateAsync({ email: email.trim(), role }));
    } catch (err) {
      setError(err instanceof ApiError ? (err.fieldError("email") ?? err.problem.detail) : "The invitation could not be sent.");
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={close}
      title={issued ? "Invitation sent" : "Invite people"}
      description={issued ? undefined : "They'll get an email with a link to join. Links work once and expire in 7 days."}
    >
      {issued ? (
        <div className="flex flex-col gap-4">
          <p className="text-[15px] leading-relaxed">
            We emailed <span className="font-semibold">{issued.email}</span>. You can also share this link directly. It's
            shown only once.
          </p>
          <div className="flex items-center gap-2 rounded-md bg-paper p-2 ring-1 ring-line">
            <code className="min-w-0 flex-1 truncate px-1 text-sm" aria-label="Invitation link">{issued.accept_url}</code>
            <Button
              variant="secondary"
              className="h-9 shrink-0"
              onClick={async () => {
                await navigator.clipboard.writeText(issued.accept_url);
                setCopied(true);
              }}
            >
              {copied ? <Check aria-hidden className="size-4 text-approve" /> : <Copy aria-hidden className="size-4" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setIssued(null); setEmail(""); setCopied(false); }}>Invite someone else</Button>
            <Button onClick={() => close(false)}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={error} autoComplete="off" />
          <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as InvitableRole)}>
            <option value="member">Member: submits and approves requests</option>
            <option value="admin">Admin: also manages people and workflows</option>
          </Select>
          {actorRole !== "owner" && <p className="-mt-2 text-sm text-muted">Only owners can make someone an owner, after they join.</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => close(false)}>Cancel</Button>
            <Button type="submit" busy={invite.isPending}>Send invitation</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
