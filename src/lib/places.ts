import type { PlaceDoc, PlacePin, PlaceSummaryEntry } from "./types";

// Client-side twin of functions/placesLogic.js — the compact entry shape
// ({ n, la, lo, u?, s?, b? }) lives in placesSummary/current; these helpers
// rehydrate it into the PlacePins the map/pickers read, and overlay the
// recent-changes delta on top. See PlacesSummaryDoc in types.ts for the why.

/** Rehydrate the placesSummary entries into PlacePins, dropping malformed
 *  entries (a place with no name or coordinates can't render on the map). */
export function summaryToPlaces(
  entries: Record<string, PlaceSummaryEntry> | undefined,
): PlacePin[] {
  const out: PlacePin[] = [];
  for (const [id, e] of Object.entries(entries ?? {})) {
    if (!e || typeof e.n !== "string") continue;
    if (typeof e.la !== "number" || typeof e.lo !== "number") continue;
    const pin: PlacePin = { id, name: e.n, lat: e.la, lng: e.lo };
    if (e.u === true) pin.nude = true;
    if (typeof e.s === "number") pin.lastSwimAt = e.s;
    if (typeof e.b === "string") pin.lastSwimBorder = e.b;
    out.push(pin);
  }
  return out;
}

/**
 * Overlay the recent-changes delta (full place docs created or edited since
 * the summary was built) onto the summary pins. A delta doc replaces the
 * summary's name/lat/lng/nude for its id but KEEPS the summary's lastSwim*
 * (the daily aggregate — a same-day rename must not drop the pin's glow, and
 * the delta doc's own lastSwim* can be staler or absent); delta-only ids
 * (brand-new spots not yet in any summary) are appended, taking their glow
 * from the doc itself. An empty delta returns the input array itself, so
 * derive()'s reference-equality memo only churns when something changed.
 */
export function mergeDelta(
  summaryPins: PlacePin[],
  delta: PlaceDoc[],
): PlacePin[] {
  if (delta.length === 0) return summaryPins;
  const byId = new Map(summaryPins.map((p) => [p.id, p]));
  for (const d of delta) {
    if (!d || typeof d.id !== "string") continue;
    if (typeof d.lat !== "number" || typeof d.lng !== "number") continue;
    if (typeof d.name !== "string") continue;
    const base = byId.get(d.id);
    const pin: PlacePin = { id: d.id, name: d.name, lat: d.lat, lng: d.lng };
    if (d.nude === true) pin.nude = true;
    const at = base?.lastSwimAt ?? d.lastSwimAt;
    const border = base?.lastSwimBorder ?? d.lastSwimBorder;
    if (typeof at === "number") pin.lastSwimAt = at;
    if (typeof border === "string") pin.lastSwimBorder = border;
    byId.set(d.id, pin);
  }
  return [...byId.values()];
}
