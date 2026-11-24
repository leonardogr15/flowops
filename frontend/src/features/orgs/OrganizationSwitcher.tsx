import * as Menu from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus } from "lucide-react";

import { CreateOrganizationDialog } from "./CreateOrganizationDialog";
import { ROLE_LABEL, useOrganization } from "./organization";

export function OrganizationSwitcher() {
  const { memberships, active, select } = useOrganization();
  const queryClient = useQueryClient();
  if (!active) return null;

  function choose(slug: string) {
    if (slug === active?.organization.slug) return;
    select(slug);
    queryClient.removeQueries({ queryKey: ["org"] }); // never show one tenant's data under another
  }

  return (
    <div className="flex flex-col gap-2">
      <Menu.Root>
        <Menu.Trigger
          className="flex w-full items-center gap-3 rounded-md bg-ink-soft px-3 py-2.5 text-left ring-1 ring-ink-line hover:bg-ink-line/60"
          aria-label={`Organization: ${active.organization.name}. Switch organization`}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-paper">{active.organization.name}</span>
            <span className="block text-xs text-paper/60">{ROLE_LABEL[active.role]}</span>
          </span>
          <ChevronsUpDown aria-hidden className="size-4 text-paper/60" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content
            align="start"
            sideOffset={6}
            className="z-50 w-64 rounded-md bg-surface p-1 text-ink shadow-xl ring-1 ring-line"
          >
            <Menu.Label className="px-2 py-1.5 text-xs font-medium text-muted">Your organizations</Menu.Label>
            {memberships.map((m) => (
              <Menu.Item
                key={m.organization.slug}
                onSelect={() => choose(m.organization.slug)}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm outline-none data-[highlighted]:bg-paper"
              >
                <span className="min-w-0 flex-1 truncate">{m.organization.name}</span>
                <span className="text-xs text-muted">{ROLE_LABEL[m.role]}</span>
                {m.organization.slug === active.organization.slug && <Check aria-label="Current" className="size-4 text-signal" />}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      <CreateOrganizationDialog
        trigger={
          <button className="flex items-center gap-2 rounded px-3 py-1.5 text-sm text-paper/70 hover:bg-ink-soft hover:text-paper">
            <Plus aria-hidden className="size-4" /> New organization
          </button>
        }
      />
    </div>
  );
}
