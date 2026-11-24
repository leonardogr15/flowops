import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ensureCsrf, unwrap, type RequestDetail, type RequestStatus } from "../../api/client";
import { useOrganization } from "../orgs/organization";

export function useSlug(): string {
  return useOrganization().active?.organization.slug ?? "";
}

const header = (slug: string) => ({ header: { "X-Organization": slug } });

/** Cursor-paginated list; the page shows 25 at a time with "Show more". */
export function useRequests(scope: "mine" | "all", status: RequestStatus | "") {
  const slug = useSlug();
  return useInfiniteQuery({
    queryKey: ["org", slug, "requests", scope, status],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET("/api/v1/org/requests", {
          params: {
            ...header(slug),
            query: { scope, ...(status ? { status } : {}), ...(pageParam ? { cursor: pageParam } : {}), page_size: 25 },
          },
        }),
      ),
    getNextPageParam: (last) => (last.next ? (new URL(last.next, window.location.origin).searchParams.get("cursor") ?? undefined) : undefined),
    enabled: Boolean(slug),
  });
}

export function useRequest(id: string | undefined) {
  const slug = useSlug();
  return useQuery({
    queryKey: ["org", slug, "requests", "detail", id],
    queryFn: () => unwrap(api.GET("/api/v1/org/requests/{id}", { params: { ...header(slug), path: { id: id ?? "" } } })),
    enabled: Boolean(slug && id),
  });
}

export function useComments(id: string, enabled = true) {
  const slug = useSlug();
  return useQuery({
    queryKey: ["org", slug, "requests", "comments", id],
    queryFn: () => unwrap(api.GET("/api/v1/org/requests/{id}/comments", { params: { ...header(slug), path: { id } } })),
    enabled: Boolean(slug) && enabled,
  });
}

export function useTimeline(id: string) {
  const slug = useSlug();
  return useQuery({
    queryKey: ["org", slug, "requests", "timeline", id],
    queryFn: () => unwrap(api.GET("/api/v1/org/requests/{id}/timeline", { params: { ...header(slug), path: { id } } })),
    enabled: Boolean(slug),
  });
}

export function useInbox() {
  const slug = useSlug();
  return useQuery({
    queryKey: ["org", slug, "inbox"],
    queryFn: () => unwrap(api.GET("/api/v1/org/inbox", { params: header(slug) })),
    enabled: Boolean(slug),
    refetchInterval: 30_000,
  });
}

/** Every request mutation refreshes the tenant's request, inbox and notification data. */
function useRequestMutation<TArgs, TResult>(fn: (slug: string, args: TArgs) => Promise<TResult>) {
  const slug = useSlug();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: TArgs) => {
      await ensureCsrf();
      return fn(slug, args);
    },
    // Refresh on errors too: a 409 means someone else changed the request first.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["org", slug] }),
  });
}

export interface RequestFieldsInput {
  title: string;
  description: string;
  amount: string | null;
  currency: string;
}

export function useCreateRequest() {
  return useRequestMutation<RequestFieldsInput & { template: string }, RequestDetail>((slug, body) =>
    unwrap(api.POST("/api/v1/org/requests", { body, params: header(slug) })),
  );
}

export function useUpdateRequest() {
  return useRequestMutation<RequestFieldsInput & { id: string; revision: number }, RequestDetail>(
    (slug, { id, ...body }) =>
      unwrap(api.PATCH("/api/v1/org/requests/{id}", { body, params: { ...header(slug), path: { id } } })),
  );
}

export function useSubmitRequest() {
  return useRequestMutation<{ id: string; revision: number }, RequestDetail>((slug, { id, revision }) =>
    unwrap(api.POST("/api/v1/org/requests/{id}/submit", { body: { revision }, params: { ...header(slug), path: { id } } })),
  );
}

export function useDecision() {
  return useRequestMutation<{ id: string; step: number; approve: boolean; comment: string }, RequestDetail>(
    (slug, { id, step, approve, comment }) => {
      const options = { body: { step, comment }, params: { ...header(slug), path: { id } } };
      return unwrap(
        approve
          ? api.POST("/api/v1/org/requests/{id}/approve", options)
          : api.POST("/api/v1/org/requests/{id}/reject", options),
      );
    },
  );
}

export function useCancelRequest() {
  return useRequestMutation<string, RequestDetail>((slug, id) =>
    unwrap(api.POST("/api/v1/org/requests/{id}/cancel", { params: { ...header(slug), path: { id } } })),
  );
}

export function useDuplicateRequest() {
  return useRequestMutation<string, RequestDetail>((slug, id) =>
    unwrap(api.POST("/api/v1/org/requests/{id}/duplicate", { params: { ...header(slug), path: { id } } })),
  );
}

export function useAddComment() {
  return useRequestMutation<{ id: string; body: string }, unknown>((slug, { id, body }) =>
    unwrap(api.POST("/api/v1/org/requests/{id}/comments", { body: { body }, params: { ...header(slug), path: { id } } })),
  );
}

export const STATUS_LABEL: Record<RequestStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const money = new Map<string, Intl.NumberFormat>();
export function formatAmount(amount: string | null | undefined, currency: string): string | null {
  if (amount == null || !currency) return null;
  if (!money.has(currency)) money.set(currency, new Intl.NumberFormat(undefined, { style: "currency", currency }));
  return money.get(currency)!.format(Number(amount));
}
