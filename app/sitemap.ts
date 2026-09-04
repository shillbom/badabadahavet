import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site";
import { getDb } from "@/server/firebaseAdmin";
import {
  buildSitemapEntries,
  entriesFromPlacesSummaryDoc,
} from "@/server/sitemap";
import type { PlacesSummaryDoc } from "@/lib/types";

/**
 * /sitemap.xml — the static public routes plus one `/spot/<id>` per place.
 *
 * Replaces the hand-rolled `sitemap` Cloud Function: Next serialises the XML,
 * we only supply the URLs (contents and their tests live in
 * src/server/sitemap.ts).
 *
 * It reads ONE document — `placesSummary/current`, the same daily-built doc
 * the map reads (see CLAUDE.md, "places are read from a summary doc, not the
 * collection"). Listing ~5.4k spot URLs therefore costs a single Firestore
 * read, once an hour, not a ~5.4k-doc collection scan.
 */

// firebase-admin needs Node, not the Edge runtime.
export const runtime = "nodejs";

// The underlying doc is rebuilt once a day; an hour is plenty fresh and keeps
// a crawler hammering /sitemap.xml down to one read per hour.
export const revalidate = 3600;

// ~5.4k URLs today, and the sitemap spec's limit is 50k. If the place count
// ever approaches that, split this into shards with Next's generateSitemaps()
// rather than growing one file past the limit.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let summary: PlacesSummaryDoc | null = null;
  try {
    const snap = await getDb().doc("placesSummary/current").get();
    summary = snap.exists ? (snap.data() as PlacesSummaryDoc) : null;
  } catch (e) {
    // A sitemap listing only the static routes is recoverable; a 500 tells
    // the crawler the sitemap itself is broken.
    console.error("sitemap: placesSummary read failed", String(e));
  }

  return buildSitemapEntries({
    origin: SITE_ORIGIN,
    placeEntries: entriesFromPlacesSummaryDoc(summary),
    builtAt: summary?.builtAt,
  });
}
