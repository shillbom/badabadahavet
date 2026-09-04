// Pure place-summary helpers used by the daily sweep
// (scripts/update-places-summary.mjs) and mirrored on the client
// (src/lib/places.ts) — no firebase-admin imports so they're trivially
// unit-testable.
//
// A place "summary entry" is the compact shape packed into
// placesSummary/current: { n: name, la: lat, lo: lng, u?: naturist,
// s?: lastSwimAt, b?: lastSwimBorder }. Single-letter keys keep thousands
// of them inside the one-doc size budget (same reasoning as TempReading).

/** Build the placesSummary entries map from a list of plain place records
 *  ({ id, name, lat, lng, nude }) and a per-place last-swim lookup (Map or
 *  object of placeId → { at, border } | null). Emits only the fields the
 *  always-on map/pickers read: `u` only for naturist spots, `s`/`b` only when
 *  the place has a known last swim, and `b` omitted when the border is "none"
 *  (pinRingFor treats undefined and "none" identically). Places without a
 *  name or valid coordinates are dropped — they can't render on the map. */
export function buildPlacesSummaryEntries(places, lastSwimByPlaceId) {
  const lookup =
    lastSwimByPlaceId instanceof Map
      ? lastSwimByPlaceId
      : new Map(Object.entries(lastSwimByPlaceId ?? {}));
  const entries = {};
  for (const p of places ?? []) {
    if (!p || typeof p.id !== "string") continue;
    if (typeof p.name !== "string" || p.name.length === 0) continue;
    if (typeof p.lat !== "number" || typeof p.lng !== "number") continue;
    const entry = { n: p.name, la: p.lat, lo: p.lng };
    if (p.nude === true) entry.u = true;
    const last = lookup.get(p.id);
    if (last && typeof last.at === "number") {
      entry.s = last.at;
      if (typeof last.border === "string" && last.border !== "none") {
        entry.b = last.border;
      }
    }
    entries[p.id] = entry;
  }
  return entries;
}

/** True when two entry maps differ — lets the sweep skip the summary write
 *  (and its one-read-per-client fan-out) on a no-change day. Mirrors
 *  summaryChanged/qualityMapChanged in tempLogic.js. */
export function placesSummaryChanged(oldEntries, newEntries) {
  const a = oldEntries ?? {};
  const b = newEntries ?? {};
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return true;
  for (const k of aKeys) {
    const x = a[k];
    const y = b[k];
    if (!y) return true;
    if (
      x.n !== y.n ||
      x.la !== y.la ||
      x.lo !== y.lo ||
      x.u !== y.u ||
      x.s !== y.s ||
      x.b !== y.b
    ) {
      return true;
    }
  }
  return false;
}
