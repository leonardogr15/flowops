import { ChevronLeft } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";

import { ApiError, type RequestDetail } from "../../api/client";
import { Select, useNotice } from "../../shared/ui/overlays";
import { Button, Field, PageLoading, StateMessage } from "../../shared/ui/primitives";
import { useTemplates } from "../workflows/queries";
import { useCreateRequest, useUpdateRequest, type RequestFieldsInput } from "./queries";

const COMMON_CURRENCIES = ["USD", "EUR", "GBP", "COP", "MXN", "BRL", "CAD", "AUD", "JPY", "CHF"];

type Errors = Partial<Record<"template" | "title" | "description" | "amount" | "currency" | "form", string>>;

function validate(fields: RequestFieldsInput, template: string): Errors {
  const errors: Errors = {};
  if (!template) errors.template = "Choose the workflow this request follows.";
  if (fields.title.trim().length < 3) errors.title = "Enter a title of at least 3 characters.";
  const hasAmount = (fields.amount ?? "").trim() !== "";
  if (hasAmount && !/^\d+(\.\d{1,2})?$/.test(fields.amount!.trim())) errors.amount = "Use a positive number with up to 2 decimals.";
  if (hasAmount && !/^[A-Za-z]{3}$/.test(fields.currency.trim())) errors.currency = "Use a 3-letter currency code, such as USD.";
  if (!hasAmount && fields.currency.trim()) errors.amount = "Enter an amount for the selected currency.";
  return errors;
}

/** Create a draft, or edit an existing draft (with its revision for conflict detection). */
export function RequestForm({ draft }: { draft?: RequestDetail }) {
  const navigate = useNavigate();
  const notify = useNotice();
  const templates = useTemplates();
  const create = useCreateRequest();
  const update = useUpdateRequest();
  const [template, setTemplate] = useState(draft?.template.id ?? "");
  const [fields, setFields] = useState<RequestFieldsInput>({
    title: draft?.title ?? "",
    description: draft?.description ?? "",
    amount: draft?.amount ?? "",
    currency: draft?.currency || "USD",
  });
  const [errors, setErrors] = useState<Errors>({});

  const published = (templates.data ?? []).filter((t) => t.published_version);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validate(fields, template);
    setErrors(found);
    if (Object.keys(found).length) return;
    const hasAmount = (fields.amount ?? "").trim() !== "";
    const body = {
      title: fields.title.trim(),
      description: fields.description.trim(),
      amount: hasAmount ? fields.amount!.trim() : null,
      currency: hasAmount ? fields.currency.trim().toUpperCase() : "",
    };
    try {
      if (draft) {
        await update.mutateAsync({ id: draft.id, revision: draft.revision, ...body });
        notify("Draft saved");
        navigate(`/requests/${draft.id}`);
      } else {
        const created = await create.mutateAsync({ template, ...body });
        notify("Draft created");
        navigate(`/requests/${created.id}`, { replace: true });
      }
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors({
          title: error.fieldError("title"),
          amount: error.fieldError("amount"),
          currency: error.fieldError("currency"),
          template: error.fieldError("template"),
          form: error.problem.errors ? undefined : error.problem.detail,
        });
      } else setErrors({ form: "The request could not be saved. Try again." });
    }
  }

  if (templates.isPending) return <PageLoading label="Loading workflows" />;
  if (!draft && published.length === 0) {
    return (
      <StateMessage title="No workflows to use yet">
        An admin needs to publish a workflow before requests can be created.
      </StateMessage>
    );
  }

  return (
    <>
      <Link to={draft ? `/requests/${draft.id}` : "/requests"} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink">
        <ChevronLeft aria-hidden className="size-4" /> {draft ? "Back to request" : "Requests"}
      </Link>
      <h1 className="mb-2 text-[2rem] leading-tight font-semibold tracking-tight">{draft ? "Edit draft" : "New request"}</h1>
      <p className="mb-8 max-w-prose text-[15px] text-muted">
        Saved as a draft first. Nothing is sent for approval until you submit it.
      </p>
      <form onSubmit={onSubmit} noValidate className="flex max-w-xl flex-col gap-5">
        {errors.form && <p role="alert" className="rounded-md bg-reject-wash px-3 py-2.5 text-sm text-reject">{errors.form}</p>}
        <Select label="Workflow" value={template} disabled={Boolean(draft)} onChange={(e) => setTemplate(e.target.value)} error={errors.template}>
          <option value="" disabled>Choose a workflow</option>
          {(draft ? [{ id: draft.template.id, name: draft.template.name }] : published).map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
        <Field label="Title" value={fields.title} maxLength={160} onChange={(e) => setFields({ ...fields, title: e.target.value })} error={errors.title} placeholder="e.g. Laptop for the new designer" />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="request-description" className="text-sm font-medium">
            Details <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id="request-description"
            rows={4}
            maxLength={4000}
            value={fields.description}
            onChange={(e) => setFields({ ...fields, description: e.target.value })}
            className="rounded-md bg-surface px-3 py-2 text-[15px] ring-1 ring-line outline-none ring-inset focus:ring-2 focus:ring-signal"
            placeholder="What is it for, and why now?"
          />
        </div>
        <fieldset className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
          <legend className="mb-1.5 text-sm font-medium">
            Amount <span className="font-normal text-muted">(optional)</span>
          </legend>
          <Field label="Amount" inputMode="decimal" value={fields.amount ?? ""} onChange={(e) => setFields({ ...fields, amount: e.target.value })} error={errors.amount} placeholder="1450.00" />
          <Field label="Currency" list="currency-codes" maxLength={3} value={fields.currency} onChange={(e) => setFields({ ...fields, currency: e.target.value.toUpperCase() })} error={errors.currency} />
          <datalist id="currency-codes">
            {COMMON_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </datalist>
        </fieldset>
        <div className="flex gap-2">
          <Button type="submit" busy={create.isPending || update.isPending}>{draft ? "Save draft" : "Create draft"}</Button>
          <Link to={draft ? `/requests/${draft.id}` : "/requests"} className="inline-flex h-10 items-center rounded-md px-4 text-sm font-semibold text-ink hover:bg-ink/5">Cancel</Link>
        </div>
      </form>
    </>
  );
}
