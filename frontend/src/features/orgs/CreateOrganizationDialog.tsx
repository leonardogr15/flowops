import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

import { api, ApiError, ensureCsrf, unwrap } from "../../api/client";
import { Button, Field } from "../../shared/ui/primitives";
import { membershipsKey, useOrganization } from "./organization";

export function CreateOrganizationDialog({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const queryClient = useQueryClient();
  const { select } = useOrganization();

  const create = useMutation({
    mutationFn: async (value: string) => {
      await ensureCsrf();
      return unwrap(api.POST("/api/v1/organizations", { body: { name: value } }));
    },
    onSuccess: async (membership) => {
      await queryClient.invalidateQueries({ queryKey: membershipsKey });
      select(membership.organization.slug);
      setOpen(false);
      setName("");
    },
    onError: (err) => setError(err instanceof ApiError ? (err.fieldError("name") ?? err.problem.detail) : "Could not create the organization."),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim().length < 2) {
      setError("Use at least 2 characters.");
      return;
    }
    setError(undefined);
    create.mutate(name.trim());
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { setOpen(next); if (!next) setError(undefined); }}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-ink/40 data-[state=open]:animate-in" />
        <Dialog.Content className="fixed top-1/2 left-1/2 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-surface p-6 shadow-2xl focus:outline-none">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-semibold">Create an organization</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted">
                You'll be its owner. You can invite people once it exists.
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded p-1 text-muted hover:bg-paper" aria-label="Close">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-5" noValidate>
            <Field label="Organization name" value={name} onChange={(e) => setName(e.target.value)} error={error} maxLength={120} />
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button type="button" variant="secondary">Cancel</Button>
              </Dialog.Close>
              <Button type="submit" busy={create.isPending}>Create organization</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
