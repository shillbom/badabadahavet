/**
 * The server read for a spot page. Deliberately the *same* four reads the
 * retired `spotPreview` Cloud Function made — the place doc, an aggregate
 * count of its swims, a bounded window of recent swims (for the photo and the
 * rendered list) and `tempSummary/current` — so server-rendering the page
 * costs no more than generating a meta tag used to, and now the result is
 * cached instead of thrown away (`revalidate` on the page).
 *
 * Two invariants from CLAUDE.md shape this:
 *   - No fan-out. Four bounded reads per *render*, not per request: the page
 *     is revalidated hourly and re-rendered on demand, so crawler traffic
 *     doesn't multiply reads.
 *   - Temps live OFF the place docs. The reading comes from the single
 *     `tempSummary/current` doc, exactly like the map. The live per-place
 *     `placeTemps/{id}` subscription stays on the client.
 */

import { cache } from "react";
import { logger } from "./api";
import { getDb } from "./firebaseAdmin";
import type { PlaceDoc, SessionDoc, TempReading } from "@/lib/types";

/** How many recent swims to read. Doubles as the rendered list and the photo
 *  search window — the same bound `spotPreview` used. Most spots have fewer
 *  swims than this; the busiest have a few hundred, and a crawler (or a first
 *  paint) does not need the full history: the client's live listener streams
 *  the rest in on hydration. */
const RECENT_SWIMS = 25;

export type SpotSnapshot = {
  /** null when the id doesn't exist (deleted spot, typo'd share link). */
  place: PlaceDoc | null;
  /** True when the read itself failed. Distinguishes "this spot is gone"
   *  (404 is correct) from "Firestore was unavailable" (render the client
   *  shell and let it try again — never 404 a real page over a blip). */
  failed: boolean;
  /** Total swims ever logged here (aggregate count, not a document read). */
  swimCount: number;
  /** The newest `RECENT_SWIMS` swims, newest first. */
  sessions: SessionDoc[];
  /** Latest known reading from `tempSummary/current`, or null. */
  reading: TempReading | null;
  /** The newest swim photo within that window — the share-card image. */
  photoUrl: string | null;
};

const EMPTY: SpotSnapshot = {
  place: null,
  failed: false,
  swimCount: 0,
  sessions: [],
  reading: null,
  photoUrl: null,
};

/**
 * Strip anything that can't cross the server→client boundary. Every field in
 * PlaceDoc/SessionDoc is already a primitive (dates are epoch ms on purpose,
 * see src/lib/types.ts), but a legacy doc carrying a Firestore Timestamp
 * would make React throw "Only plain objects can be passed to Client
 * Components" and blank the whole page. A JSON round-trip on ≤26 small docs
 * is cheap insurance.
 */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Read everything the spot page and its metadata need.
 *
 * Wrapped in React's `cache()` so `generateMetadata()` and the page component
 * — which run as two separate calls for one render — share a single set of
 * reads instead of doubling them.
 *
 * Never throws: a Firestore hiccup degrades to the site-level share defaults
 * and a client-rendered page, which is better than a 500 on a public URL.
 */
export const loadSpotSnapshot = cache(
  async (placeId: string): Promise<SpotSnapshot> => {
    if (!placeId) return EMPTY;
    try {
      const db = getDb();
      const placeSnap = await db.collection("places").doc(placeId).get();
      if (!placeSnap.exists) return EMPTY;
      const place = placeSnap.data() as PlaceDoc;

      const forPlace = db
        .collection("sessions")
        .where("placeId", "==", placeId);
      const [countSnap, recentSnap, tempSnap] = await Promise.all([
        forPlace.count().get(),
        forPlace.orderBy("date", "desc").limit(RECENT_SWIMS).get(),
        db.doc("tempSummary/current").get(),
      ]);

      const sessions = plain(
        recentSnap.docs.map((d) => d.data() as SessionDoc),
      );
      const entry = tempSnap.exists
        ? (tempSnap.data()?.entries?.[placeId] as TempReading | undefined)
        : undefined;

      return {
        // `id` is stored on the doc, but fall back to the path id so a legacy
        // doc missing the field still renders (the client's getPlace does the
        // same by reading data() straight into PlaceDoc).
        place: plain({ ...place, id: place.id ?? placeSnap.id }),
        failed: false,
        swimCount: countSnap.data().count ?? 0,
        sessions,
        reading:
          entry && typeof entry.t === "number" && typeof entry.at === "number"
            ? entry
            : null,
        photoUrl: sessions.find((s) => s.photoUrl)?.photoUrl ?? null,
      };
    } catch (e) {
      logger.warn("spot snapshot read failed", {
        placeId,
        error: String(e),
      });
      return { ...EMPTY, failed: true };
    }
  },
);
