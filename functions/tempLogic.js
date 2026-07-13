// Pure water-temperature helpers shared by the refreshPlaceTemp Cloud
// Function, the daily sweep (scripts/update-temperatures.mjs), and the
// client (mirrored in src/lib/temps.ts) — no firebase-admin imports so
// they're trivially unit-testable.
//
// A "reading" is the compact shape stored in tempSummary/current and
// placeTemps/{placeId}: { t: °C, at: epoch ms sampled, p: provider }.

/** Validate a loose object (a placeTemps doc, a summary entry) into a
 *  reading, or null when the temp fields are absent/malformed. Returns the
 *  input object itself when valid, so identities stay stable. */
export function asReading(x) {
  if (!x) return null;
  if (typeof x.t !== "number" || Number.isNaN(x.t)) return null;
  if (typeof x.at !== "number" || Number.isNaN(x.at)) return null;
  if (typeof x.p !== "string") return null;
  return x;
}

/** Whichever of two readings was sampled most recently (null when both are
 *  missing). Ties keep `a` so a live per-place doc beats the daily summary. */
export function freshestReading(a, b) {
  const ra = asReading(a);
  const rb = asReading(b);
  if (!ra) return rb;
  if (!rb) return ra;
  return rb.at > ra.at ? rb : ra;
}

/** Convert the legacy on-place temp fields (waterTemp/waterTempAt/
 *  waterTempProvider) into a reading. This is the automatic first-run
 *  backfill: the sweep folds it in so pre-split readings carry over into
 *  the summary without refetching; it becomes a no-op once the legacy
 *  fields are scrubbed. */
export function readingFromLegacyPlace(placeData) {
  if (!placeData) return null;
  return asReading({
    t: placeData.waterTemp,
    at: placeData.waterTempAt,
    p: placeData.waterTempProvider ?? "open-meteo",
  });
}

/** Assemble tempSummary entries from a per-place reading lookup
 *  (Map or plain object of placeId → reading|null), dropping places with
 *  no reading and stripping any extra fields (placeId, checkedAt). */
export function buildSummaryEntries(readingsByPlaceId) {
  const entries = {};
  const pairs =
    readingsByPlaceId instanceof Map
      ? readingsByPlaceId.entries()
      : Object.entries(readingsByPlaceId);
  for (const [placeId, raw] of pairs) {
    const r = asReading(raw);
    if (r) entries[placeId] = { t: r.t, at: r.at, p: r.p };
  }
  return entries;
}

/** True when two entry maps differ — lets the sweep skip the summary write
 *  (and its one-read-per-client fan-out) on a no-change day. */
export function summaryChanged(oldEntries, newEntries) {
  const a = oldEntries ?? {};
  const b = newEntries ?? {};
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return true;
  for (const k of aKeys) {
    const x = a[k];
    const y = b[k];
    if (!y) return true;
    if (x.t !== y.t || x.at !== y.at || x.p !== y.p) return true;
  }
  return false;
}
