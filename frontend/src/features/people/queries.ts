import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ensureCsrf, unwrap, type InvitableRole, type IssuedInvitation, type Role } from "../../api/client";
import { membershipsKey, useOrganization } from "../orgs/organization";

function useSlug(): string {
  return useOrganization().active?.organization.slug ?? "";
}

const header = (slug: string) => ({ header: { "X-Organization": slug } });

export function useMembers() {
  const slug = useSlug();
  return useQuery({
    queryKey: ["org", slug, "members"],
    queryFn: () => unwrap(api.GET("/api/v1/org/members", { params: { ...header(slug), query: { page_size: 100 } } })),
    enabled: Boolean(slug),
  });
}

export function useInvitations(enabled: boolean) {
  const slug = useSlug();
  return useQuery({
    queryKey: ["org", slug, "invitations"],
    queryFn: () => unwrap(api.GET("/api/v1/org/invitations", { params: header(slug) })),
    enabled: Boolean(slug) && enabled,
  });
}

/** Mutations invalidate everything tenant-scoped for the active organization afterwards. */
function useOrgMutation<TArgs, TResult>(fn: (slug: string, args: TArgs) => Promise<TResult>) {
  const slug = useSlug();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: TArgs) => {
      await ensureCsrf();
      return fn(slug, args);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["org", slug] }),
        queryClient.invalidateQueries({ queryKey: membershipsKey }),
      ]);
    },
  });
}

export function useInvite() {
  return useOrgMutation<{ email: string; role: InvitableRole }, IssuedInvitation>((slug, body) =>
    unwrap(api.POST("/api/v1/org/invitations", { body, params: header(slug) })) as Promise<IssuedInvitation>,
  );
}

export function useRevokeInvitation() {
  return useOrgMutation<string, void>((slug, id) =>
    unwrap(api.DELETE("/api/v1/org/invitations/{id}", { params: { ...header(slug), path: { id } } })),
  );
}

export function useChangeRole() {
  return useOrgMutation<{ id: string; role: Role }, unknown>((slug, { id, role }) =>
    unwrap(api.PATCH("/api/v1/org/members/{id}", { body: { role }, params: { ...header(slug), path: { id } } })),
  );
}

export function useRemoveMember() {
  return useOrgMutation<string, void>((slug, id) =>
    unwrap(api.DELETE("/api/v1/org/members/{id}", { params: { ...header(slug), path: { id } } })),
  );
}
