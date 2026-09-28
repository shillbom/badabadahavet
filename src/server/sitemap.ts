/**
 * Sitemap contents — the pure half of `app/sitemap.ts`.
 *
 * Next owns the XML now (it serialises whatever `app/sitemap.ts` returns), so
 * the hand-rolled `buildSitemapXml` from the retired `sitemap` Cloud Function
 * is gone. What survived the move is what actually had bugs worth testing:
 * unpacking `placesSummary/current`, skipping malformed entries, and picking
 * an honest `lastModified`. That logic lives here with its own vitest suite.
 *
 * Only `<loc>` and `<lastmod>` are emitted. Google ignores `<changefreq>` and
 * `<priority>`, and ~5.4k copies of them were ~150 KB of dead weight.
 */

import type { PlaceSummaryEntry, PlacesSummaryDoc } from "@/lib/types";

export type SitemapEntry = {
  url: string;
  lastModified?: Date;
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

/** Epoch ms → a Date Next can serialise, or `undefined` when it isn't a usable
 *  timestamp (a missing/garbled value must not produce "Invalid Date"). */
export function sitemapDate(ms: unknown): Date | undefined {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) {
    return undefined;
  }
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** The public routes that exist regardless of data, `/` first. */
export const STATIC_ROUTES = ["/", "/leaderboard", "/about", "/privacy"];

/**
 * Every URL the sitemap should list: the static public routes, then one
 * `/spot/<id>` per place.
 *
 * `/spot/...` is the canonical form now that the spot page is real HTML —
 * the old sitemap pointed at `/s/<id>`, which is a 308 to here (see
 * app/s/[placeId]/route.ts), and listing a redirect wastes crawl budget.
 *
 * `lastmod` is only emitted when it's true, because Google compares it with
 * the page and stops trusting a sitemap whose dates don't match. A spot's
 * main content is its swim list, so its lastmod is the place's last swim
 * (`s` in the summary); a spot nobody has swum at gets none. The static
 * routes get none either — stamping them "now" on every hourly rebuild was
 * exactly the kind of fake freshness that costs trust. (The old code gave
 * every spot the summary's build time, i.e. one identical date for all.)
 *
 * Ids are sorted so the output is stable between builds (a Firestore map has
 * no guaranteed key order, and a sitemap that reshuffles every hour looks
 * like churn to a crawler). Entries without a name are skipped: they can't
 * render a spot page.
 */
export function buildSitemapEntries({
  origin,
  placeEntries,
}: {
  origin: string;
  placeEntries: Record<string, PlaceSummaryEntry>;
}): SitemapEntry[] {
  const base = origin.replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) {
    throw new Error("origin must be an absolute http(s) URL");
  }

  const entries: SitemapEntry[] = STATIC_ROUTES.map((path) => ({
    url: `${base}${path}`,
  }));

  for (const id of Object.keys(placeEntries).toSorted()) {
    if (!id) continue;
    const entry = placeEntries[id];
    if (!entry || typeof entry.n !== "string" || entry.n.length === 0) continue;
    const lastModified = sitemapDate(entry.s);
    entries.push({
      url: `${base}/spot/${encodeURIComponent(id)}`,
      ...(lastModified && { lastModified }),
    });
  }

  return entries;
}
