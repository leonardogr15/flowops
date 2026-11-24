import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { api, ApiError, ensureCsrf, unwrap, type InvitationPreview } from "../../api/client";
import { Button, Field, PageLoading } from "../../shared/ui/primitives";
import { meKey, useSession } from "../auth/session";
import { ACTIVE_ORG_STORAGE_KEY, ROLE_LABEL, membershipsKey } from "../orgs/organization";

export function AcceptInvitationPage() {
  const { token = "" } = useParams();
  const { user, isLoading: sessionLoading, signOut } = useSession();
  const preview = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => unwrap(api.GET("/api/v1/invitations/{token}", { params: { path: { token } } })),
    retry: false,
  });

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <main className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-20">
        <div className="w-full max-w-sm">
          <p className="flex items-center gap-2 text-lg font-bold tracking-tight">
            <img src="/favicon.svg" alt="" className="size-7" /> FlowOps
          </p>
          <div className="mt-12">
            {preview.isPending || sessionLoading ? (
              <PageLoading label="Checking your invitation" />
            ) : preview.isError ? (
              <InvalidLink />
            ) : user ? (
              user.email.toLowerCase() === preview.data.email ? (
                <JoinAsSignedIn token={token} invitation={preview.data} />
              ) : (
                <WrongAccount invitedEmail={preview.data.email} currentEmail={user.email} onSignOut={signOut} />
              )
            ) : preview.data.account_exists ? (
              <SignInFirst token={token} invitation={preview.data} />
            ) : (
              <CreateAccount token={token} invitation={preview.data} />
            )}
          </div>
        </div>
      </main>
      <aside className="hidden flex-col justify-center bg-ink px-16 text-paper lg:flex">
        {preview.data && (
          <div className="max-w-md">
            <p className="text-paper/70">{preview.data.invited_by ?? "An administrator"} invited you to join</p>
            <p className="mt-3 text-display font-semibold">{preview.data.organization_name}</p>
            <p className="mt-6 text-paper/70">
              As {ROLE_LABEL[preview.data.role].toLowerCase()}, you'll{" "}
              {preview.data.role === "admin"
                ? "submit and approve requests, and manage people and workflows."
                : "submit requests and approve the ones routed to you."}
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

function Heading({ invitation }: { invitation: InvitationPreview }) {
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Join {invitation.organization_name}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        Invitation for <span className="font-medium text-ink">{invitation.email}</span> as{" "}
        {ROLE_LABEL[invitation.role].toLowerCase()}.
      </p>
    </>
  );
}

function useAccept(token: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: async ({ full_name = "", password = "" }: { full_name?: string; password?: string }) => {
      await ensureCsrf();
      return unwrap(api.POST("/api/v1/invitations/{token}/accept", { params: { path: { token } }, body: { full_name, password } }));
    },
    onSuccess: async (accepted) => {
      localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, accepted.organization.slug);
      queryClient.setQueryData(meKey, accepted.user);
      await queryClient.invalidateQueries({ queryKey: membershipsKey });
      navigate("/overview", { replace: true });
    },
  });
}

function acceptError(error: unknown): string {
  return error instanceof ApiError ? error.problem.detail : "The invitation could not be accepted. Try again.";
}

function JoinAsSignedIn({ token, invitation }: { token: string; invitation: InvitationPreview }) {
  const accept = useAccept(token);
  return (
    <>
      <Heading invitation={invitation} />
      {accept.isError && <p role="alert" className="mt-6 rounded-md bg-reject-wash px-3 py-2.5 text-sm text-reject">{acceptError(accept.error)}</p>}
      <Button className="mt-8 h-11 w-full" busy={accept.isPending} onClick={() => accept.mutate({})}>
        Join {invitation.organization_name}
      </Button>
    </>
  );
}

function CreateAccount({ token, invitation }: { token: string; invitation: InvitationPreview }) {
  const accept = useAccept(token);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ full_name?: string; password?: string }>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found: typeof errors = {};
    if (name.trim().length < 2) found.full_name = "Enter your name.";
    if (password.length < 12) found.password = "Use at least 12 characters.";
    setErrors(found);
    if (Object.keys(found).length) return;
    try {
      await accept.mutateAsync({ full_name: name.trim(), password });
    } catch (error) {
      if (error instanceof ApiError) setErrors({ full_name: error.fieldError("full_name"), password: error.fieldError("password") });
    }
  }

  const formError = accept.isError && !errors.full_name && !errors.password ? acceptError(accept.error) : undefined;
  return (
    <>
      <Heading invitation={invitation} />
      <form onSubmit={onSubmit} noValidate className="mt-8 flex flex-col gap-5">
        {formError && <p role="alert" className="rounded-md bg-reject-wash px-3 py-2.5 text-sm text-reject">{formError}</p>}
        <Field label="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" error={errors.full_name} />
        <Field label="Email" value={invitation.email} readOnly disabled />
        <Field
          label="Create a password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          hint="At least 12 characters. Avoid common passwords."
        />
        <Button type="submit" busy={accept.isPending} className="mt-1 h-11">Create account and join</Button>
      </form>
    </>
  );
}

function SignInFirst({ token, invitation }: { token: string; invitation: InvitationPreview }) {
  return (
    <>
      <Heading invitation={invitation} />
      <p className="mt-6 text-[15px] leading-relaxed">
        You already have a FlowOps account. Sign in as {invitation.email} to accept.
      </p>
      <Link
        to="/login"
        state={{ from: `/invite/${token}` }}
        className="mt-8 inline-flex h-11 w-full items-center justify-center rounded-md bg-signal px-4 text-sm font-semibold text-white hover:bg-signal-strong"
      >
        Sign in to accept
      </Link>
    </>
  );
}

function WrongAccount({ invitedEmail, currentEmail, onSignOut }: { invitedEmail: string; currentEmail: string; onSignOut: () => Promise<void> }) {
  return (
    <div role="alert">
      <h1 className="text-3xl font-semibold tracking-tight">This invitation is for another account</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        You're signed in as <span className="font-medium text-ink">{currentEmail}</span>, but the invitation was sent to{" "}
        <span className="font-medium text-ink">{invitedEmail}</span>. Sign out, then open the link again.
      </p>
      <Button variant="secondary" className="mt-8" onClick={() => void onSignOut()}>Sign out</Button>
    </div>
  );
}

function InvalidLink() {
  return (
    <div role="alert">
      <h1 className="text-3xl font-semibold tracking-tight">This invitation link doesn't work</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted">
        It may have expired, been used already, or been replaced by a newer invitation. Ask your organization's admin
        to send a new one.
      </p>
      <Link to="/login" className="mt-8 inline-block text-sm font-semibold text-signal hover:text-signal-strong">Go to sign in</Link>
    </div>
  );
}
