import * as Menu from "@radix-ui/react-dropdown-menu";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router";

import { api, ensureCsrf, unwrap, type AppNotification } from "../../api/client";
import { useSlug } from "../requests/queries";

const TEXT: Record<AppNotification["kind"], string> = {
  task_assigned: "Needs your decision",
  task_needs_admin: "Needs an administrator",
  request_approved: "Your request was approved",
  request_rejected: "Your request was rejected",
  comment_added: "New comment",
};

const ago = new Intl.RelativeTimeFormat("en", { numeric: "auto" }); // matches the English UI copy
function relative(iso: string): string {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return ago.format(minutes, "minute");
  if (Math.abs(minutes) < 1440) return ago.format(Math.round(minutes / 60), "hour");
  return ago.format(Math.round(minutes / 1440), "day");
}

/** Bell with unread count; polls every 30 seconds (no websockets). */
export function NotificationsMenu() {
  const slug = useSlug();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const header = { header: { "X-Organization": slug } };
  const unread = useQuery({
    queryKey: ["org", slug, "notifications", "unread"],
    queryFn: () => unwrap(api.GET("/api/v1/org/notifications/unread", { params: header })),
    enabled: Boolean(slug),
    refetchInterval: 30_000,
  });
  const list = useQuery({
    queryKey: ["org", slug, "notifications", "list"],
    queryFn: () => unwrap(api.GET("/api/v1/org/notifications", { params: { ...header, query: { page_size: 15 } } })),
    enabled: Boolean(slug),
  });
  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await ensureCsrf();
      await unwrap(api.POST("/api/v1/org/notifications/{id}/read", { params: { ...header, path: { id } } }));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["org", slug, "notifications"] }),
  });

  const count = unread.data?.unread ?? 0;
  return (
    <Menu.Root onOpenChange={(open) => open && void list.refetch()}>
      <Menu.Trigger
        className="relative rounded p-2 text-paper/75 hover:bg-ink-soft hover:text-paper"
        aria-label={count ? `Notifications, ${count} unread` : "Notifications"}
      >
        <Bell className="size-5" />
        {count > 0 && (
          <span aria-hidden className="absolute -top-0.5 -right-0.5 grid min-w-5 place-items-center rounded-full bg-signal px-1 text-[11px] font-bold text-white">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="start" sideOffset={8} className="z-50 max-h-[min(32rem,calc(100dvh-5rem))] w-80 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-md bg-surface p-1 text-ink shadow-xl ring-1 ring-line">
          <Menu.Label className="px-3 py-2 text-sm font-semibold">Notifications</Menu.Label>
          {(list.data?.results ?? []).length === 0 ? (
            <p className="px-3 pb-3 text-sm text-muted">You're all caught up.</p>
          ) : (
            list.data!.results.map((n) => (
              <Menu.Item
                key={n.id}
                onSelect={() => {
                  if (!n.read_at) markRead.mutate(n.id);
                  navigate(`/requests/${n.request}`);
                }}
                className="flex cursor-pointer gap-3 rounded px-3 py-2.5 outline-none data-[highlighted]:bg-paper"
              >
                <span aria-hidden className={clsx("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-signal")} />
                <span className="min-w-0">
                  <span className={clsx("block text-sm", !n.read_at && "font-semibold")}>{TEXT[n.kind]}</span>
                  <span className="block truncate text-sm text-muted">{n.request_title}</span>
                  <span className="block text-xs text-muted">
                    {relative(n.created_at)}
                    {!n.read_at && <span className="sr-only">, unread</span>}
                  </span>
                </span>
              </Menu.Item>
            ))
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
