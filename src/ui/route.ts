import type { EntryFilter } from "../domain/query";

export interface RouteState {
  view: string;
  filter?: EntryFilter;
}

export function encodeRoute({ view, filter }: RouteState): string {
  const query = filter && Object.keys(filter).length > 0
    ? `?f=${encodeURIComponent(JSON.stringify(filter))}`
    : "";
  return `#/${view}${query}`;
}

export function decodeRoute(hash: string, knownViews: readonly string[]): RouteState {
  try {
    if (!hash.startsWith("#/")) return { view: "Home" };
    const queryStart = hash.indexOf("?");
    const view = decodeURIComponent(hash.slice(2, queryStart < 0 ? undefined : queryStart));
    if (!knownViews.includes(view)) return { view: "Home" };
    if (queryStart < 0) return { view };

    const encodedFilter = new URLSearchParams(hash.slice(queryStart + 1)).get("f");
    if (encodedFilter === null) return { view };
    const filter: unknown = JSON.parse(encodedFilter);
    if (filter === null || typeof filter !== "object" || Array.isArray(filter)) {
      return { view: "Home" };
    }
    return { view, filter: filter as EntryFilter };
  } catch {
    return { view: "Home" };
  }
}