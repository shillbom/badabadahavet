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

// --- Water quality (latest lab sample: verdict + algae) ----------------
//
// The badplatsen detail doc the temperature already comes from also carries
// the latest official water sample: an overall verdict (E. coli + intestinal
// enterococci → Tjänligt/Otjänligt) and an algae/cyanobacteria bloom
// observation. We keep just those two sample-tied fields + the sample date
// (see WaterSample in src/lib/types.ts); they ride in tempSummary alongside
// the temp readings. Sampling is seasonal and biweekly, so freshness is
// enforced by the caller — the sweep only stores recent samples and the
// client only displays recent ones.

const numOrUndef = (x) =>
  typeof x === "number" && Number.isFinite(x) ? x : undefined;

/**
 * Pull the latest water sample ({ v, a, at }) out of a badplatsen detail
 * body, or null when there's no dated sample carrying a verdict or algae
 * value. The latest sample lives both at the top level and in `testResult`;
 * take the newest `testResult` entry by `sampleDate` (don't assume ordering —
 * same defensiveness as the SMHI reducer) and fall back to the top-level
 * fields. Numeric codes are stored raw; the UI maps them to labels.
 */
export function extractWaterSample(body) {
  if (!body || typeof body !== "object") return null;

  const results = Array.isArray(body.testResult) ? body.testResult : [];
  const latest = results.reduce(
    (best, r) =>
      typeof r?.sampleDate === "number" &&
      (!best || r.sampleDate > best.sampleDate)
        ? r
        : best,
    null,
  );

  const at = numOrUndef(latest?.sampleDate ?? body.sampleDate);
  if (at === undefined) return null;
  const v = numOrUndef(latest?.sampleValue ?? body.sampleValue);
  const a = numOrUndef(latest?.algalValue ?? body.algalValue);
  if (v === undefined && a === undefined) return null;

  const sample = { at };
  if (v !== undefined) sample.v = v;
  if (a !== undefined) sample.a = a;
  return sample;
}

/** True when two placeId→WaterSample maps differ — lets the sweep skip the
 *  summary write (and its one-read-per-client fan-out) when quality is
 *  unchanged. Mirrors summaryChanged. Either side may be null/undefined. */
export function qualityMapChanged(oldQuality, newQuality) {
  const a = oldQuality ?? {};
  const b = newQuality ?? {};
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return true;
  for (const k of aKeys) {
    const x = a[k];
    const y = b[k];
    if (!y) return true;
    if (x.v !== y.v || x.a !== y.a || x.at !== y.at) return true;
  }
  return false;
}
