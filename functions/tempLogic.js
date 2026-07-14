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

// --- Water quality (algae / bathing advisories) ------------------------
//
// The badplatsen detail doc the temperature already comes from also carries
// the official water-quality checks: algae/cyanobacteria bloom status, the
// latest lab-sample verdict (E. coli + intestinal enterococci), any active
// advisory against bathing (`dissuasion`), and the EU multi-year quality
// classification. See src/lib/types.ts (WaterQuality) for the stored shape
// and the numeric value scales.

// HaV leaves expired advisories in the `dissuasion` array (spots have been
// seen in 2026 still carrying 2024 starts), so keep only recent ones — a
// stale "unfit sample" advisory shown as current would be misleading.
const ADVISORY_KEEP_MS = 180 * 24 * 60 * 60 * 1000;

const numOrUndef = (x) =>
  typeof x === "number" && Number.isFinite(x) ? x : undefined;

/**
 * Pull a WaterQuality snapshot out of a badplatsen detail body, or null when
 * the body carries nothing useful (no sample, no classification, no current
 * advisory). `now` is passed in so the advisory recency filter is pure/testable.
 *
 * The latest lab sample lives both at the top level and in `testResult`; we
 * take the newest `testResult` entry by `sampleDate` (don't assume ordering —
 * same defensiveness as the SMHI reducer) and fall back to the top-level
 * fields. Numeric codes are stored raw; the UI maps them to labels.
 */
export function extractWaterQuality(body, now) {
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

  const sampleValue = numOrUndef(latest?.sampleValue ?? body.sampleValue);
  const algae = numOrUndef(latest?.algalValue ?? body.algalValue);
  const sampleAt = numOrUndef(latest?.sampleDate ?? body.sampleDate);
  const classification = numOrUndef(body.classification);
  const classificationYear = numOrUndef(body.classificationYear);

  const advisories = [];
  for (const d of Array.isArray(body.dissuasion) ? body.dissuasion : []) {
    const at = numOrUndef(d?.startdate);
    if (at === undefined || at < now - ADVISORY_KEEP_MS) continue;
    const entry = { type: numOrUndef(d?.type) ?? 0, at };
    if (typeof d?.description === "string" && d.description.trim()) {
      entry.text = d.description.trim();
    }
    advisories.push(entry);
  }
  advisories.sort((a, b) => b.at - a.at); // most recent first (local array)

  const wq = {};
  if (sampleValue !== undefined) wq.sampleValue = sampleValue;
  if (sampleAt !== undefined) wq.sampleAt = sampleAt;
  if (algae !== undefined) wq.algae = algae;
  if (classification !== undefined) wq.classification = classification;
  if (classificationYear !== undefined)
    wq.classificationYear = classificationYear;
  if (advisories.length) wq.advisories = advisories;

  return Object.keys(wq).length ? wq : null;
}

/** True when two WaterQuality snapshots differ — lets the sweep skip a
 *  place-doc write (and its `places`-listener fan-out) when nothing changed.
 *  Either side may be null/undefined (no data). */
export function waterQualityChanged(a, b) {
  if (!a && !b) return false;
  if (!a || !b) return true;
  if (
    a.sampleValue !== b.sampleValue ||
    a.sampleAt !== b.sampleAt ||
    a.algae !== b.algae ||
    a.classification !== b.classification ||
    a.classificationYear !== b.classificationYear
  ) {
    return true;
  }
  const aa = a.advisories ?? [];
  const ba = b.advisories ?? [];
  if (aa.length !== ba.length) return true;
  for (let i = 0; i < aa.length; i++) {
    if (
      aa[i].type !== ba[i].type ||
      aa[i].at !== ba[i].at ||
      aa[i].text !== ba[i].text
    ) {
      return true;
    }
  }
  return false;
}
