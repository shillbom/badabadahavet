/**
 * Sitemap contents — the pure half of `app/sitemap.ts`.
 *
 * Next owns the XML now (it serialises whatever `app/sitemap.ts` returns), so
 * the hand-rolled `buildSitemapXml` from the retired `sitemap` Cloud Function
 * is gone. What survived the move is what actually had bugs worth testing:
 * unpacking `placesSummary/current`, skipping malformed entries, and picking
 * a sane `lastModified`. That logic lives here with its own vitest suite.
 */

import type { PlaceSummaryEntry, PlacesSummaryDoc } from "@/lib/types";

export type SitemapEntry = {
  url: string;
  lastModified: Date;
  changeFrequency: "weekly";
  priority: number;
};

/**
 * Read the entries map out of `placesSummary/current`, which stores it as a
 * single JSON string (`packed`) to keep the doc ~7x smaller on the wire. A
 * legacy `entries` map is still accepted so a not-yet-repacked doc works, and
 * unparseable JSON yields an empty map rather than a 500 — an empty sitemap is
 * recoverable, a broken one is not.
 */
export function entriesFromPlacesSummaryDoc(
  summary: PlacesSummaryDoc | null | undefined,
): Record<string, PlaceSummaryEntry> {
  const packed = summary?.packed;
  if (typeof packed === "string" && packed) {
    try {
      const parsed: unknown = JSON.parse(packed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, PlaceSummaryEntry>;
      }
    } catch {
      return {};
    }
    return {};
  }
  const entries = summary?.entries;
  if (entries && typeof entries === "object" && !Array.isArray(entries)) {
    return entries;
  }
  return {};
}

/** Epoch ms → a Date Next can serialise, or `fallback` when it isn't a usable
 *  timestamp (a missing/garbled `builtAt` must not produce "Invalid Date"). */
export function sitemapDate(ms: unknown, fallback: Date): Date {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return fallback;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

/** The public routes that exist regardless of data. `/` first and highest —
 *  the rest are real pages a crawler should index but not prioritise. */
export const STATIC_ROUTES: { path: string; priority: number }[] = [
  { path: "/", priority: 1.0 },
  { path: "/leaderboard", priority: 0.7 },
  { path: "/about", priority: 0.5 },
  { path: "/privacy", priority: 0.3 },
];

/**
 * Every URL the sitemap should list: the static public routes, then one
 * `/spot/<id>` per place.
 *
 * `/spot/...` is the canonical form now that the spot page is real HTML —
 * the old sitemap pointed at `/s/<id>`, which is a 308 to here (see
 * app/s/[placeId]/route.ts), and listing a redirect wastes crawl budget.
 *
 * Ids are sorted so the output is stable between builds (a Firestore map has
 * no guaranteed key order, and a sitemap that reshuffles every hour looks
 * like churn to a crawler). Entries without a name are skipped: they can't
 * render a spot page.
 */
export function buildSitemapEntries({
  origin,
  placeEntries,
  builtAt,
  now = Date.now(),
}: {
  origin: string;
  placeEntries: Record<string, PlaceSummaryEntry>;
  builtAt?: unknown;
  now?: number;
}): SitemapEntry[] {
  const base = origin.replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) {
    throw new Error("origin must be an absolute http(s) URL");
  }
  const nowDate = new Date(now);
  // Places change when the daily summary is rebuilt, so that build time is
  // the honest lastmod for every spot URL.
  const placeDate = sitemapDate(builtAt, nowDate);

  const entries: SitemapEntry[] = STATIC_ROUTES.map(({ path, priority }) => ({
    url: `${base}${path === "/" ? "/" : path}`,
    lastModified: nowDate,
    changeFrequency: "weekly",
    priority,
  }));

  for (const id of Object.keys(placeEntries).toSorted()) {
    if (!id) continue;
    const entry = placeEntries[id];
    if (!entry || typeof entry.n !== "string" || entry.n.length === 0) continue;
    entries.push({
      url: `${base}/spot/${encodeURIComponent(id)}`,
      lastModified: placeDate,
      changeFrequency: "weekly",
      priority: 0.8,
    });
  }

  return entries;
}
