import * as Dialog from "@radix-ui/react-dialog";
import clsx from "clsx";
import {
  FileText,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Route,
  ScrollText,
  Settings,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";

import { useSession } from "../../features/auth/session";
import { NotificationsMenu } from "../../features/notifications/NotificationsMenu";
import { OrganizationSwitcher } from "../../features/orgs/OrganizationSwitcher";
import { canManage, useOrganization } from "../../features/orgs/organization";
import { useInbox } from "../../features/requests/queries";
import { Initials } from "../ui/primitives";

const NAV = [
  { to: "/requests", label: "Requests", icon: FileText, admin: false },
  { to: "/inbox", label: "Inbox", icon: Inbox, admin: false },
  { to: "/overview", label: "Overview", icon: LayoutDashboard, admin: false },
  { to: "/workflows", label: "Workflows", icon: Route, admin: false },
  { to: "/members", label: "Members", icon: Users, admin: false },
  { to: "/audit", label: "Audit log", icon: ScrollText, admin: true },
  { to: "/settings", label: "Settings", icon: Settings, admin: false },
] as const;

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useSession();
  const { active } = useOrganization();
  const inbox = useInbox();
  const waiting = inbox.data?.length ?? 0;
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col gap-6 bg-ink px-4 py-5 text-paper">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 px-1 text-base font-bold tracking-tight">
          <img
            src="/favicon.svg"
            alt=""
            className="size-6 ring-1 ring-ink-line rounded-md"
          />
          FlowOps
        </p>
        <NotificationsMenu />
      </div>
      <OrganizationSwitcher />
      <nav aria-label="Main" className="flex flex-col gap-0.5">
        {NAV.filter((item) => !item.admin || canManage(active?.role)).map(
          ({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onNavigate}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-paper text-ink"
                    : "text-paper/75 hover:bg-ink-soft hover:text-paper",
                )
              }
            >
              <Icon aria-hidden className="size-4" />
              <span className="flex-1">{label}</span>
              {to === "/inbox" && waiting > 0 && (
                <span className="rounded-full bg-signal px-1.5 text-xs font-bold text-white tabular-nums">
                  {waiting}
                  <span className="sr-only"> waiting</span>
                </span>
              )}
            </NavLink>
          ),
        )}
      </nav>
      <div className="mt-auto flex items-center gap-3 border-t border-ink-line pt-4">
        <Initials
          name={user?.full_name || user?.email || "?"}
          className="bg-signal"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {user?.full_name || "Signed in"}
          </p>
          <p className="truncate text-xs text-paper/60">{user?.email}</p>
        </div>
        <button
          onClick={async () => {
            await signOut();
            navigate("/login", { replace: true });
          }}
          className="rounded p-2 text-paper/70 hover:bg-ink-soft hover:text-paper"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function AppShell() {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16.5rem_minmax(0,1fr)]">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside
        aria-label="Navigation"
        className="sticky top-0 hidden h-dvh lg:block"
      >
        <Sidebar />
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between bg-ink px-4 py-3 text-paper lg:hidden">
        <p className="flex items-center gap-2 font-bold">
          <img src="/favicon.svg" alt="" className="size-6" /> FlowOps
        </p>
        <div className="flex items-center gap-1">
          <NotificationsMenu />
          <button
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            aria-expanded={open}
            className="rounded p-2 hover:bg-ink-soft"
          >
            <MenuIcon className="size-5" />
          </button>
        </div>
      </header>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/50 lg:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] focus:outline-none lg:hidden">
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <Sidebar onNavigate={() => setOpen(false)} />
            <Dialog.Close
              aria-label="Close navigation"
              className="absolute top-4 right-3 rounded p-1.5 text-paper/80 hover:bg-ink-soft"
            >
              <X className="size-5" />
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <main id="content" className="px-5 py-8 sm:px-10 lg:px-14 lg:py-12">
        <Outlet />
      </main>
    </div>
  );
}
