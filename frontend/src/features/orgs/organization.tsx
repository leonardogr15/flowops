import { useQuery } from "@tanstack/react-query";
import { createContext, use, useEffect, useMemo, useState, type ReactNode } from "react";

import { api, setActiveOrganization, unwrap, type MyMembership } from "../../api/client";

const STORAGE_KEY = "flowops.activeOrganization";
export const membershipsKey = ["memberships"] as const;

interface OrganizationState {
  memberships: MyMembership[];
  active: MyMembership | null;
  isLoading: boolean;
  error: unknown;
  select: (slug: string) => void;
}

const OrganizationContext = createContext<OrganizationState | null>(null);

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: membershipsKey,
    queryFn: () => unwrap(api.GET("/api/v1/organizations")),
  });
  const [preferred, setPreferred] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY));

  const memberships = useMemo(() => query.data ?? [], [query.data]);
  // A stored slug is only a preference: it is honored only if the user is still a member.
  const active = memberships.find((m) => m.organization.slug === preferred) ?? memberships[0] ?? null;
  const activeSlug = active?.organization.slug ?? null;

  setActiveOrganization(activeSlug); // synchronous, so child queries never run without the header
  useEffect(() => {
    if (activeSlug) localStorage.setItem(STORAGE_KEY, activeSlug);
  }, [activeSlug]);

  const value: OrganizationState = {
    memberships,
    active,
    isLoading: query.isPending,
    error: query.error,
    select: setPreferred,
  };
  return <OrganizationContext value={value}>{children}</OrganizationContext>;
}

export function useOrganization(): OrganizationState {
  const state = use(OrganizationContext);
  if (!state) throw new Error("useOrganization must be used inside <OrganizationProvider>");
  return state;
}

export const ROLE_LABEL: Record<MyMembership["role"], string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export function canManage(role: MyMembership["role"] | undefined): boolean {
  return role === "owner" || role === "admin";
}
