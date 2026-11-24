/**
 * Cursor of the next page from a DRF cursor-pagination `next` link (absolute or relative).
 * Returns undefined on the last page, so it can be used directly as TanStack's getNextPageParam.
 */
export function cursorOf(next: string | null | undefined): string | undefined {
  if (!next) return undefined;
  try {
    return new URL(next, window.location.origin).searchParams.get("cursor") ?? undefined;
  } catch {
    return undefined;
  }
}
