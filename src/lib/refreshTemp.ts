import { auth, cloudFn } from "@/firebase";

const STALE_AFTER_MS = 60 * 60 * 1000; // 1 hour
const LOCAL_THROTTLE_MS = 5 * 60 * 1000; // don't ask for the same place more than once per 5 min

// In-memory record of the last refresh we triggered for each place,
// so React re-renders or rapid re-opens don't spam the function call.
const lastRequested = new Map<string, number>();

const callable = cloudFn<{ placeId: string }, unknown>("refreshPlaceTemp");

/**
 * Trigger a server-side temperature refresh for a place if the known
 * reading (its `at` timestamp — from placeTemps or the temp summary) is
 * older than an hour. The result lands in `placeTemps/{placeId}`, so only
 * call this from somewhere that subscribes to that doc (SpotPage) — the
 * map reads the daily summary and would never see the update. Silently
 * no-ops if:
 *   - the reading is fresh,
 *   - we already asked recently,
 *   - or the user isn't signed in.
 */
export function maybeRefreshPlaceTemp(
  placeId: string,
  readingAt?: number,
): void {
  if (!auth.currentUser) return;

  const now = Date.now();
  const age = readingAt ? now - readingAt : Infinity;
  if (age < STALE_AFTER_MS) return;

  const last = lastRequested.get(placeId) ?? 0;
  if (now - last < LOCAL_THROTTLE_MS) return;
  lastRequested.set(placeId, now);

  // Fire-and-forget: the placeTemps snapshot subscription will pick up
  // any update automatically.
  callable({ placeId }).catch(() => {
    // Throttle / network failures are non-fatal; the user just sees the
    // old reading. Clear our local cache so a retry on next open is OK.
    lastRequested.delete(placeId);
  });
}
