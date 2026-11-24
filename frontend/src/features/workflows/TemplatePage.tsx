import { ChevronLeft } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { ApiError, type Category, type Member, type TemplateDetail } from "../../api/client";
import { ConfirmDialog, Select, useNotice } from "../../shared/ui/overlays";
import { Button, Field, PageLoading, StateMessage } from "../../shared/ui/primitives";
import { canManage, useOrganization } from "../orgs/organization";
import { useMembers } from "../people/queries";
import { CATEGORY_LABEL, useCreateTemplate, usePublish, useSaveDraft, useTemplate, useUpdateTemplate, type TemplateFields } from "./queries";
import { RoutePreview } from "./RoutePreview";
import {
  fromServer,
  newStep,
  serverStepErrors,
  StepBuilder,
  toInput,
  validateSteps,
  type StepDraft,
  type StepErrors,
} from "./StepBuilder";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function BackLink() {
  return (
    <Link to="/workflows" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink">
      <ChevronLeft aria-hidden className="size-4" /> Workflows
    </Link>
  );
}

export function TemplatePage() {
  const { id } = useParams();
  const { active } = useOrganization();
  const admin = canManage(active?.role);
  const template = useTemplate(id);
  const members = useMembers();

  if (!id) return admin ? <TemplateEditor members={members.data?.results ?? []} /> : <NotAllowed />;
  if (template.isPending || members.isPending) return <PageLoading label="Loading workflow" />;
  if (template.isError) {
    const notFound = template.error instanceof ApiError && template.error.status === 404;
    return (
      <>
        <BackLink />
        <StateMessage tone={notFound ? "neutral" : "error"} title={notFound ? "Workflow not found" : "This workflow didn't load"}>
          {notFound ? "It may have been removed, or it isn't published yet." : "Reload the page to try again."}
        </StateMessage>
      </>
    );
  }
  const memberList = members.data?.results ?? [];
  return admin ? (
    <TemplateEditor key={template.data.id} template={template.data} members={memberList} />
  ) : (
    <TemplateReadOnly template={template.data} members={memberList} />
  );
}

function NotAllowed() {
  return (
    <>
      <BackLink />
      <StateMessage title="Only admins can create workflows">Ask an owner or admin to set up a new approval route.</StateMessage>
    </>
  );
}

function TemplateReadOnly({ template, members }: { template: TemplateDetail; members: Member[] }) {
  const version = template.published;
  const steps = useMemo(() => fromServer(version?.steps ?? []), [version]);
  return (
    <>
      <BackLink />
      <header className="mb-8 max-w-3xl">
        <p className="text-sm text-muted">{CATEGORY_LABEL[template.category]}</p>
        <h1 className="mt-1 text-[2rem] leading-tight font-semibold tracking-tight">{template.name}</h1>
        {template.description && <p className="mt-2 text-[15px] leading-relaxed text-muted">{template.description}</p>}
        {version && (
          <p className="mt-3 text-sm text-muted">
            Version {version.number}
            {version.published_at ? `, published ${dateFormat.format(new Date(version.published_at))}` : ""}
            {version.published_by ? ` by ${version.published_by}` : ""}
          </p>
        )}
      </header>
      <div className="max-w-md">
        <RoutePreview name={template.name} steps={steps} members={members} />
      </div>
    </>
  );
}

interface EditorProps {
  template?: TemplateDetail;
  members: Member[];
}

function initialSteps(template?: TemplateDetail): StepDraft[] {
  const source = template?.draft ?? template?.published;
  return source && source.steps.length ? fromServer(source.steps) : [newStep()];
}

function TemplateEditor({ template, members }: EditorProps) {
  const navigate = useNavigate();
  const notify = useNotice();
  const create = useCreateTemplate();
  const update = useUpdateTemplate();
  const saveDraft = useSaveDraft();
  const publish = usePublish();

  const initialFields: TemplateFields = {
    name: template?.name ?? "",
    category: template?.category ?? "purchase",
    description: template?.description ?? "",
  };
  const [fields, setFields] = useState<TemplateFields>(initialFields);
  const [steps, setSteps] = useState<StepDraft[]>(() => initialSteps(template));
  const [saved, setSaved] = useState(() => JSON.stringify({ f: initialFields, s: toInput(initialSteps(template)) }));
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof TemplateFields, string>>>({});
  const [stepErrors, setStepErrors] = useState<StepErrors>({});
  const [listError, setListError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [confirmPublish, setConfirmPublish] = useState(false);

  const snapshot = JSON.stringify({ f: fields, s: toInput(steps) });
  const dirty = snapshot !== saved;
  const fieldsDirty = JSON.stringify(fields) !== JSON.stringify(JSON.parse(saved).f);
  const busy = create.isPending || update.isPending || saveDraft.isPending || publish.isPending;
  const draftNumber = template?.draft?.number ?? (template?.published ? template.published.number + 1 : 1);
  const canPublish = Boolean(template && (template.draft || dirty));

  function validate(): boolean {
    const errors: typeof fieldErrors = {};
    if (fields.name.trim().length < 2) errors.name = "Name the workflow (at least 2 characters).";
    const { list, byStep } = validateSteps(steps);
    setFieldErrors(errors);
    setStepErrors(byStep);
    setListError(list);
    setFormError(undefined);
    return !Object.keys(errors).length && !list && !Object.keys(byStep).length;
  }

  function applyServerError(error: unknown) {
    if (!(error instanceof ApiError)) {
      setFormError("Changes could not be saved. Try again.");
      return;
    }
    const errors = error.problem.errors ?? {};
    setFieldErrors({ name: error.fieldError("name"), category: error.fieldError("category"), description: error.fieldError("description") });
    const fromServerSteps = serverStepErrors(errors.steps);
    setStepErrors(fromServerSteps.byStep);
    setListError(fromServerSteps.list);
    setFormError(Object.keys(errors).length ? undefined : error.problem.detail);
  }

  /** Persists details and steps; returns false when validation or the server rejects them. */
  async function persist(): Promise<boolean> {
    if (!validate()) return false;
    try {
      if (!template) {
        const created = await create.mutateAsync({ ...fields, name: fields.name.trim(), steps: toInput(steps) });
        notify("Draft created");
        navigate(`/workflows/${created.id}`, { replace: true });
        return true;
      }
      if (fieldsDirty) await update.mutateAsync({ id: template.id, ...fields, name: fields.name.trim() });
      await saveDraft.mutateAsync({ id: template.id, steps: toInput(steps) });
      setSaved(snapshot);
      return true;
    } catch (error) {
      applyServerError(error);
      return false;
    }
  }

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await persist()) notify(template ? "Draft saved" : "Draft created");
  }

  async function onPublish() {
    if (!template) return;
    if (dirty && !(await persist())) {
      setConfirmPublish(false);
      return;
    }
    try {
      await publish.mutateAsync(template.id);
      setConfirmPublish(false);
      notify(`Version ${draftNumber} published`);
    } catch (error) {
      setConfirmPublish(false);
      applyServerError(error);
    }
  }

  return (
    <>
      <BackLink />
      <header className="mb-8 flex max-w-6xl flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-[2rem] leading-tight font-semibold tracking-tight">{template ? template.name : "New workflow"}</h1>
          <p className="mt-2 text-sm text-muted">
            {!template
              ? "Saved as a draft. Publish it when the route is right."
              : template.published
                ? `Version ${template.published.number} is live.${template.draft || dirty ? ` You're editing version ${draftNumber}.` : ""}`
                : `Draft version ${draftNumber}, not published yet.`}
          </p>
        </div>
      </header>

      <form onSubmit={onSave} noValidate className="grid max-w-6xl gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-10">
          <section aria-labelledby="details-heading" className="flex flex-col gap-5">
            <h2 id="details-heading" className="text-lg font-semibold">Details</h2>
            {formError && <p role="alert" className="rounded-md bg-reject-wash px-3 py-2.5 text-sm text-reject">{formError}</p>}
            <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <Field
                label="Workflow name"
                value={fields.name}
                maxLength={120}
                placeholder="e.g. Purchase over $1,000"
                onChange={(e) => setFields({ ...fields, name: e.target.value })}
                error={fieldErrors.name}
              />
              <Select
                label="Request type"
                value={fields.category}
                onChange={(e) => setFields({ ...fields, category: e.target.value as Category })}
                error={fieldErrors.category}
              >
                {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="template-description" className="text-sm font-medium">
                Description <span className="font-normal text-muted">(optional)</span>
              </label>
              <textarea
                id="template-description"
                rows={3}
                maxLength={1000}
                value={fields.description}
                onChange={(e) => setFields({ ...fields, description: e.target.value })}
                className="rounded-md bg-surface px-3 py-2 text-[15px] ring-1 ring-line outline-none ring-inset focus:ring-2 focus:ring-signal"
                placeholder="When should people use this workflow?"
              />
            </div>
          </section>

          <StepBuilder steps={steps} onChange={setSteps} members={members} errors={stepErrors} listError={listError} />

          <div className="sticky bottom-0 -mx-5 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-paper/95 px-5 py-4 backdrop-blur sm:-mx-10 sm:px-10 lg:mx-0 lg:rounded-lg lg:border lg:px-4">
            <p className="mr-auto text-sm text-muted" role="status">{dirty ? "Unsaved changes" : template ? "All changes saved" : ""}</p>
            <Button type="submit" variant={template ? "secondary" : "primary"} busy={create.isPending || update.isPending || saveDraft.isPending} disabled={busy || (!!template && !dirty)}>
              {template ? "Save draft" : "Create draft"}
            </Button>
            {template && canPublish && (
              <Button type="button" disabled={busy} onClick={() => setConfirmPublish(true)}>
                {dirty ? "Save and publish" : `Publish version ${draftNumber}`}
              </Button>
            )}
          </div>
        </div>

        <aside aria-label="Route preview and versions" className="flex flex-col gap-6 lg:sticky lg:top-8 lg:self-start">
          <RoutePreview name={fields.name} steps={steps} members={members} />
          {template && template.history.length > 0 && (
            <section aria-labelledby="history-heading">
              <h2 id="history-heading" className="text-sm font-semibold">Versions</h2>
              <ul className="mt-2 space-y-1.5 text-sm">
                {template.history.map((v) => (
                  <li key={v.number} className="flex justify-between gap-3">
                    <span>Version {v.number}</span>
                    <span className="text-muted">
                      {v.status === "published" ? "Live" : v.status === "draft" ? "Draft" : "Archived"}
                      {v.published_at ? `, ${dateFormat.format(new Date(v.published_at))}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </form>

      <ConfirmDialog
        open={confirmPublish}
        onOpenChange={setConfirmPublish}
        title={`Publish version ${draftNumber}?`}
        description={
          template?.published
            ? `New requests will follow this route. Requests already in progress keep version ${template.published.number}.`
            : "New requests will follow this route."
        }
        confirmLabel={`Publish version ${draftNumber}`}
        busy={busy}
        onConfirm={() => void onPublish()}
      />
    </>
  );
}
