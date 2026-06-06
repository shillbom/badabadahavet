import { auth, cloudFn } from "@/lib/firebase";

const STALE_AFTER_MS = 60 * 60 * 1000; // 1 hour
const LOCAL_THROTTLE_MS = 5 * 60 * 1000; // don't ask for the same place more than once per 5 min

// In-memory record of the last refresh we triggered for each place,
// so React re-renders or rapid hovers don't spam the function call.
const lastRequested = new Map<string, number>();

type Place = { id: string; externalId?: string; waterTempAt?: number };

const callable = cloudFn<{ placeId: string }, unknown>("refreshPlaceTemp");

/**
 * Trigger a server-side temperature refresh for `place` if the stored
 * reading is older than an hour. Silently no-ops if:
 *   - the place has no externalId (we can't refresh it),
 *   - the reading is fresh,
 *   - we already asked recently,
 *   - or the user isn't signed in.
 */
export function maybeRefreshPlaceTemp(place: Place): void {
  if (!auth.currentUser) return;
  if (!place.externalId) return;

  const now = Date.now();
  const age = place.waterTempAt ? now - place.waterTempAt : Infinity;
  if (age < STALE_AFTER_MS) return;

  const last = lastRequested.get(place.id) ?? 0;
  if (now - last < LOCAL_THROTTLE_MS) return;
  lastRequested.set(place.id, now);

  // Fire-and-forget: the Firestore snapshot subscription will pick up
  // any update automatically.
  callable({ placeId: place.id }).catch(() => {
    // Throttle / network failures are non-fatal; the user just sees the
    // old reading. Clear our local cache so a retry on next open is OK.
    lastRequested.delete(place.id);
  });
}
