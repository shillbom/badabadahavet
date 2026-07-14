// Presentational helpers for the official Hav och Vatten water-quality
// snapshot stored on a place (see WaterQuality in lib/types.ts). The parsing
// lives server-side (functions/tempLogic.js extractWaterQuality); the client
// only reads the already-parsed object and maps its numeric codes to a
// severity level + decides what is fresh enough to show.

import type { WaterAdvisory, WaterQuality } from "./types";

/** How a value should be coloured: neutral info, mild warning, or a real
 *  "don't swim" signal. `muted` = known-but-unremarkable (e.g. "no data"). */
export type QualitySeverity = "ok" | "warn" | "bad" | "muted";

/** Latest lab-sample verdict: 1 suitable · 2 with remarks · 3 unfit · 4 none. */
export function sampleSeverity(v: number | undefined): QualitySeverity {
  switch (v) {
    case 1:
      return "ok";
    case 2:
      return "warn";
    case 3:
      return "bad";
    default:
      return "muted";
  }
}

/** Algae bloom: 3 bloom · 4 no bloom · 5 no data. */
export function algaeSeverity(v: number | undefined): QualitySeverity {
  switch (v) {
    case 3:
      return "bad";
    case 4:
      return "ok";
    default:
      return "muted";
  }
}

/** EU multi-year classification: 1 excellent · 2 good · 3 sufficient ·
 *  4 poor · 6 new · 0 not classified. */
export function classSeverity(v: number | undefined): QualitySeverity {
  switch (v) {
    case 1:
    case 2:
      return "ok";
    case 3:
      return "warn";
    case 4:
      return "bad";
    default:
      return "muted";
  }
}

// HaV lab samples are seasonal (roughly June–August) and infrequent, so the
// 7-day gate used for live temperatures would hide everything. Show the
// latest sample when it's from the current bathing season — ~200 days keeps
// late-summer data visible through the autumn but drops last year's once a
// new season is under way. Every line still shows its sample date.
export const SAMPLE_FRESH_MS = 200 * 24 * 60 * 60 * 1000;

export function isSampleFresh(
  at: number | undefined,
  now: number = Date.now(),
): boolean {
  return typeof at === "number" && now - at <= SAMPLE_FRESH_MS;
}

/** Advisories worth showing now. The sweep already filters stale ones at
 *  sync time; this re-applies the season window at read time (an advisory
 *  stored months ago may have aged out since) as defence in depth. */
export function visibleAdvisories(
  wq: WaterQuality | undefined,
  now: number = Date.now(),
): WaterAdvisory[] {
  if (!wq?.advisories?.length) return [];
  return wq.advisories.filter((a) => now - a.at <= SAMPLE_FRESH_MS);
}

/** True when a place's water quality has anything worth rendering: a current
 *  advisory, a fresh sample (algae or verdict), or an EU classification. */
export function hasDisplayableQuality(
  wq: WaterQuality | undefined,
  now: number = Date.now(),
): boolean {
  if (!wq) return false;
  if (visibleAdvisories(wq, now).length) return true;
  if (isSampleFresh(wq.sampleAt, now) && (wq.sampleValue || wq.algae))
    return true;
  // Classification 0 ("not classified") and 6 ("new") aren't worth a line.
  return (
    typeof wq.classification === "number" &&
    wq.classification >= 1 &&
    wq.classification <= 4
  );
}
