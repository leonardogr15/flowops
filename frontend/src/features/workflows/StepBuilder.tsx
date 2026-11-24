import clsx from "clsx";
import { ArrowDown, ArrowUp, Plus, Trash2, UserRound, Users } from "lucide-react";
import { useState } from "react";

import type { Member, Role, Step, StepInput } from "../../api/client";
import { Select } from "../../shared/ui/overlays";
import { Field } from "../../shared/ui/primitives";
import { ROLE_LABEL } from "../orgs/organization";

export const MAX_STEPS = 10;

/** A step being edited. `key` keeps React identity stable while steps move. */
export interface StepDraft {
  key: string;
  name: string;
  approver_type: "user" | "role";
  approver_user: string | null;
  approver_role: Role | "";
}

export type StepErrors = Record<number, Partial<Record<"name" | "approver_user" | "approver_role", string>>>;

let counter = 0;
const nextKey = () => `step-${++counter}`;

export function newStep(): StepDraft {
  return { key: nextKey(), name: "", approver_type: "role", approver_user: null, approver_role: "admin" };
}

export function fromServer(steps: Step[]): StepDraft[] {
  return steps.map((s) => ({
    key: nextKey(),
    name: s.name,
    approver_type: s.approver_type,
    approver_user: s.approver_user?.id ?? null,
    approver_role: (s.approver_role || "") as Role | "",
  }));
}

export function toInput(steps: StepDraft[]): StepInput[] {
  return steps.map((s) => ({
    name: s.name.trim(),
    approver_type: s.approver_type,
    approver_user: s.approver_type === "user" ? s.approver_user : null,
    approver_role: s.approver_type === "role" ? s.approver_role : "",
  }));
}

export function validateSteps(steps: StepDraft[]): { list?: string; byStep: StepErrors } {
  const byStep: StepErrors = {};
  steps.forEach((s, i) => {
    const e: StepErrors[number] = {};
    if (s.name.trim().length < 2) e.name = "Name this step (at least 2 characters).";
    if (s.approver_type === "user" && !s.approver_user) e.approver_user = "Choose who approves this step.";
    if (s.approver_type === "role" && !s.approver_role) e.approver_role = "Choose a role.";
    if (Object.keys(e).length) byStep[i] = e;
  });
  const list = steps.length === 0 ? "Add at least one approval step." : steps.length > MAX_STEPS ? `Use at most ${MAX_STEPS} steps.` : undefined;
  return { list, byStep };
}

/** Maps server errors (list or index-keyed dict) to per-step messages. */
export function serverStepErrors(raw: unknown): { list?: string; byStep: StepErrors } {
  const byStep: StepErrors = {};
  if (Array.isArray(raw) && raw.every((r) => typeof r === "string")) return { list: raw[0] as string, byStep };
  const entries: [string, unknown][] = Array.isArray(raw) ? raw.map((v, i) => [String(i), v]) : Object.entries((raw as object) ?? {});
  for (const [index, value] of entries) {
    if (!value || typeof value !== "object") continue;
    const fields: StepErrors[number] = {};
    for (const [field, messages] of Object.entries(value as Record<string, unknown>)) {
      if (Array.isArray(messages) && typeof messages[0] === "string") fields[field as keyof StepErrors[number]] = messages[0];
    }
    if (Object.keys(fields).length) byStep[Number(index)] = fields;
  }
  return { byStep };
}

export function approverLabel(step: StepDraft, members: Member[]): string {
  if (step.approver_type === "user") {
    const m = members.find((x) => x.user.id === step.approver_user);
    return m ? m.user.full_name || m.user.email : "Choose a person";
  }
  return step.approver_role ? `Any ${ROLE_LABEL[step.approver_role].toLowerCase()}` : "Choose a role";
}

interface Props {
  steps: StepDraft[];
  onChange: (steps: StepDraft[]) => void;
  members: Member[];
  errors: StepErrors;
  listError?: string;
}

export function StepBuilder({ steps, onChange, members, errors, listError }: Props) {
  const update = (index: number, patch: Partial<StepDraft>) =>
    onChange(steps.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const [announcement, setAnnouncement] = useState("");
  const focusLater = (selector: string) =>
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus());
  const nameOf = (index: number) => steps[index]!.name.trim() || `Step ${index + 1}`;
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const copy = [...steps];
    [copy[index], copy[target]] = [copy[target]!, copy[index]!];
    onChange(copy);
    setAnnouncement(`${nameOf(index)} moved to position ${target + 1} of ${steps.length}.`);
    // Focus follows the moved step; at the first or last position the pressed button is disabled,
    // so keep keyboard focus on the step's other arrow instead of losing it.
    const key = steps[index]!.key;
    if (delta === -1 && target === 0) focusLater(`[data-step-key="${key}"][data-step-action="down"]`);
    if (delta === 1 && target === steps.length - 1) focusLater(`[data-step-key="${key}"][data-step-action="up"]`);
  };
  const remove = (index: number) => {
    const removed = nameOf(index);
    const rest = steps.filter((_, i) => i !== index);
    onChange(rest);
    setAnnouncement(`${removed} removed. ${rest.length} ${rest.length === 1 ? "step" : "steps"} left.`);
    const next = rest[Math.min(index, rest.length - 1)];
    focusLater(next ? `[data-step-key="${next.key}"][data-step-action="remove"]` : "[data-step-action='add']");
  };

  return (
    <section aria-labelledby="steps-heading">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
        <h2 id="steps-heading" className="text-lg font-semibold">Approval steps</h2>
        <p className="text-sm text-muted">Requests move through these steps in order.</p>
      </div>
      {listError && <p role="alert" className="mt-3 rounded-md bg-reject-wash px-3 py-2 text-sm text-reject">{listError}</p>}
      <p aria-live="polite" className="sr-only">{announcement}</p>

      <ol className="mt-5">
        {steps.map((step, index) => (
          <StepCard
            key={step.key}
            step={step}
            index={index}
            total={steps.length}
            members={members}
            errors={errors[index] ?? {}}
            onUpdate={(patch) => update(index, patch)}
            onMove={(delta) => move(index, delta)}
            onRemove={() => remove(index)}
          />
        ))}
      </ol>

      <button
        type="button"
        data-step-action="add"
        onClick={() => onChange([...steps, newStep()])}
        disabled={steps.length >= MAX_STEPS}
        className="mt-2 ml-11 inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold border border-dashed border-signal/50 text-signal hover:bg-signal-wash disabled:cursor-not-allowed disabled:border-line disabled:text-muted"
      >
        <Plus aria-hidden className="size-4" />
        {steps.length >= MAX_STEPS ? `Maximum of ${MAX_STEPS} steps` : "Add step"}
      </button>
    </section>
  );
}

interface CardProps {
  step: StepDraft;
  index: number;
  total: number;
  members: Member[];
  errors: StepErrors[number];
  onUpdate: (patch: Partial<StepDraft>) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}

function StepCard({ step, index, total, members, errors, onUpdate, onMove, onRemove }: CardProps) {
  const number = index + 1;
  const iconButton = "rounded p-1.5 text-muted hover:bg-paper hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <li className="relative flex gap-3 pb-4">
      {index < total - 1 && <span aria-hidden className="absolute top-9 left-[15px] h-[calc(100%-2rem)] w-px bg-line" />}
      <span aria-hidden className="mt-3 grid size-8 shrink-0 place-items-center rounded-full bg-ink text-sm font-semibold text-paper">
        {number}
      </span>
      <div className="min-w-0 flex-1 rounded-lg bg-surface p-4 ring-1 ring-line">
        <div className="flex items-start gap-2">
          <Field
            label={`Step ${number} name`}
            value={step.name}
            maxLength={120}
            placeholder="e.g. Finance review"
            onChange={(e) => onUpdate({ name: e.target.value })}
            error={errors.name}
            className="min-w-0 flex-1"
          />
          <div className="mt-7 flex shrink-0 items-center">
            <button type="button" data-step-key={step.key} data-step-action="up" className={iconButton} onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move step ${number} up`}>
              <ArrowUp className="size-4" />
            </button>
            <button type="button" data-step-key={step.key} data-step-action="down" className={iconButton} onClick={() => onMove(1)} disabled={index === total - 1} aria-label={`Move step ${number} down`}>
              <ArrowDown className="size-4" />
            </button>
            <button type="button" data-step-key={step.key} data-step-action="remove" className={clsx(iconButton, "hover:text-reject")} onClick={onRemove} aria-label={`Remove step ${number}`}>
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Who approves step {number}</legend>
          <div className="mt-1.5 inline-flex rounded-md bg-paper p-0.5 ring-1 ring-line">
            {(
              [
                ["role", "Anyone with a role", Users],
                ["user", "A specific person", UserRound],
              ] as const
            ).map(([value, label, Icon]) => (
              <label
                key={value}
                className={clsx(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-signal",
                  step.approver_type === value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
                )}
              >
                <input
                  type="radio"
                  className="sr-only"
                  name={`${step.key}-type`}
                  value={value}
                  checked={step.approver_type === value}
                  onChange={() => onUpdate({ approver_type: value })}
                />
                <Icon aria-hidden className="size-4" />
                {label}
              </label>
            ))}
          </div>
          <div className="mt-3 max-w-sm">
            {step.approver_type === "role" ? (
              <Select
                label={`Role that approves step ${number}`}
                hideLabel
                value={step.approver_role}
                onChange={(e) => onUpdate({ approver_role: e.target.value as Role })}
                error={errors.approver_role}
              >
                <option value="" disabled>Choose a role</option>
                {(["member", "admin", "owner"] as const).map((r) => (
                  <option key={r} value={r}>Any {ROLE_LABEL[r].toLowerCase()}</option>
                ))}
              </Select>
            ) : (
              <Select
                label={`Person who approves step ${number}`}
                hideLabel
                value={step.approver_user ?? ""}
                onChange={(e) => onUpdate({ approver_user: e.target.value || null })}
                error={errors.approver_user}
              >
                <option value="" disabled>Choose a person</option>
                {members.map((m) => (
                  <option key={m.user.id} value={m.user.id}>
                    {m.user.full_name || m.user.email} ({ROLE_LABEL[m.role].toLowerCase()})
                  </option>
                ))}
              </Select>
            )}
          </div>
        </fieldset>
      </div>
    </li>
  );
}
