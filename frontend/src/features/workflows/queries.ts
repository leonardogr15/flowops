import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ensureCsrf, unwrap, type Category, type StepInput, type TemplateDetail } from "../../api/client";
import { useOrganization } from "../orgs/organization";

function useSlug(): string {
  return useOrganization().active?.organization.slug ?? "";
}

const header = (slug: string) => ({ header: { "X-Organization": slug } });

export function useTemplates() {
  const slug = useSlug();
  return useQuery({
    queryKey: ["org", slug, "templates"],
    queryFn: () => unwrap(api.GET("/api/v1/org/workflow-templates", { params: header(slug) })),
    enabled: Boolean(slug),
  });
}

export function useTemplate(id: string | undefined) {
  const slug = useSlug();
  return useQuery({
    queryKey: ["org", slug, "templates", id],
    queryFn: () =>
      unwrap(api.GET("/api/v1/org/workflow-templates/{id}", { params: { ...header(slug), path: { id: id ?? "" } } })),
    enabled: Boolean(slug && id),
  });
}

function useTemplateMutation<TArgs, TResult>(fn: (slug: string, args: TArgs) => Promise<TResult>) {
  const slug = useSlug();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: TArgs) => {
      await ensureCsrf();
      return fn(slug, args);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["org", slug, "templates"] }),
  });
}

export interface TemplateFields {
  name: string;
  category: Category;
  description: string;
}

export function useCreateTemplate() {
  return useTemplateMutation<TemplateFields & { steps: StepInput[] }, TemplateDetail>((slug, body) =>
    unwrap(api.POST("/api/v1/org/workflow-templates", { body, params: header(slug) })),
  );
}

export function useUpdateTemplate() {
  return useTemplateMutation<{ id: string } & Partial<TemplateFields>, TemplateDetail>((slug, { id, ...body }) =>
    unwrap(api.PATCH("/api/v1/org/workflow-templates/{id}", { body, params: { ...header(slug), path: { id } } })),
  );
}

export function useSaveDraft() {
  return useTemplateMutation<{ id: string; steps: StepInput[] }, unknown>((slug, { id, steps }) =>
    unwrap(api.PUT("/api/v1/org/workflow-templates/{id}/draft", { body: { steps }, params: { ...header(slug), path: { id } } })),
  );
}

export function usePublish() {
  return useTemplateMutation<string, unknown>((slug, id) =>
    unwrap(api.POST("/api/v1/org/workflow-templates/{id}/publish", { params: { ...header(slug), path: { id } } })),
  );
}

export const CATEGORY_LABEL: Record<Category, string> = {
  purchase: "Purchase",
  expense: "Expense",
  access: "Access",
  other: "Other",
};
