import type {
  PlaceDoc,
  PlaceTempDoc,
  PlaceWithTemp,
  TempReading,
} from "./types";

// Client-side twins of functions/tempLogic.js — the compact reading shape
// ({ t, at, p }) lives in tempSummary/current and placeTemps/{placeId};
// these helpers turn it back into the waterTemp* fields the UI reads.

/** Validate a loose object (a placeTemps doc, a summary entry) into a
 *  reading, or null when the temp fields are absent/malformed. Returns the
 *  input object itself when valid, so identities stay stable. */
export function asReading(
  x: PlaceTempDoc | TempReading | null | undefined,
): TempReading | null {
  if (!x) return null;
  if (typeof x.t !== "number" || Number.isNaN(x.t)) return null;
  if (typeof x.at !== "number" || Number.isNaN(x.at)) return null;
  if (typeof x.p !== "string") return null;
  return x as TempReading;
}

/** Whichever of two readings was sampled most recently (null when both are
 *  missing). Ties keep `a` so a live per-place doc beats the daily summary. */
export function freshestReading(
  a: PlaceTempDoc | TempReading | null | undefined,
  b: TempReading | null | undefined,
): TempReading | null {
  const ra = asReading(a);
  const rb = asReading(b);
  if (!ra) return rb;
  if (!rb) return ra;
  return rb.at > ra.at ? rb : ra;
}

/** The tempSummary entries map as a Map, dropping malformed entries. */
export function summaryToMap(
  entries: Record<string, TempReading> | undefined,
): Map<string, TempReading> {
  const m = new Map<string, TempReading>();
  for (const [placeId, raw] of Object.entries(entries ?? {})) {
    const r = asReading(raw);
    if (r) m.set(placeId, r);
  }
  return m;
}

/**
 * Merge the summary readings onto the places array by id. Places without a
 * reading pass through as the same object (a PlaceDoc is a valid
 * PlaceWithTemp), and an empty temps map returns the input array itself —
 * so downstream reference-equality memos only churn where a temp actually
 * exists.
 */
export function mergePlaceTemps(
  places: PlaceDoc[],
  temps: Map<string, TempReading>,
): PlaceWithTemp[] {
  if (temps.size === 0) return places;
  return places.map((p) => {
    const r = temps.get(p.id);
    if (!r) return p;
    return {
      ...p,
      waterTemp: r.t,
      waterTempAt: r.at,
      waterTempProvider: r.p,
    };
  });
}
