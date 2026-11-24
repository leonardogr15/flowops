import { useEffect } from "react";

const TITLES: [RegExp, string][] = [
  [/^\/overview$/, "Overview"],
  [/^\/requests\/new$/, "New request"],
  [/^\/requests\/[^/]+\/edit$/, "Edit draft"],
  [/^\/requests\/[^/]+$/, "Request"],
  [/^\/requests$/, "Requests"],
  [/^\/inbox$/, "Inbox"],
  [/^\/audit$/, "Audit log"],
  [/^\/members$/, "Members"],
  [/^\/workflows\/new$/, "New workflow"],
  [/^\/workflows\/[^/]+$/, "Workflow"],
  [/^\/workflows$/, "Workflows"],
  [/^\/settings$/, "Settings"],
];

/** Title of an in-app page, for the browser tab and screen readers (WCAG 2.4.2). */
export function titleFor(pathname: string): string {
  return TITLES.find(([pattern]) => pattern.test(pathname))?.[1] ?? "Page not found";
}

export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · FlowOps`;
  }, [title]);
}
