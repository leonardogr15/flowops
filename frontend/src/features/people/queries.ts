import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ensureCsrf, unwrap, type InvitableRole, type IssuedInvitation, type Member, type Role } from "../../api/client";
import { cursorOf } from "../../api/pagination";
import { membershipsKey, useOrganization } from "../orgs/organization";

function useSlug(): string {
  return useOrganization().active?.organization.slug ?? "";
}

const header = (slug: string) => ({ header: { "X-Organization": slug } });

function membersPage(slug: string, cursor: string | undefined, pageSize: number) {
  return unwrap(
    api.GET("/api/v1/org/members", {
      params: { ...header(slug), query: { page_size: pageSize, ...(cursor ? { cursor } : {}) } },
    }),
  );
}

/** Members page by page ("Show more"); the API caps a page at 100. */
export function useMembers() {
  const slug = useSlug();
  return useInfiniteQuery({
    queryKey: ["org", slug, "members", "pages"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => membersPage(slug, pageParam, 50),
    getNextPageParam: (last) => cursorOf(last.next),
    enabled: Boolean(slug),
  });
}

/** Every member, for pickers such as "who approves this step" (follows all pages). */
export function useAllMembers() {
  const slug = useSlug();
  return useQuery({
    queryKey: ["org", slug, "members", "all"],
    queryFn: async () => {
      const all: Member[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 100; page++) {
        const data = await membersPage(slug, cursor, 100);
        all.push(...data.results);
        cursor = cursorOf(data.next);
        if (!cursor) break;
      }
      return all;
    },
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
