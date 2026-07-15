// Presentational helpers for the official Hav och Vatten water sample stored
// per place in tempSummary/current (see WaterSample in lib/types.ts). Parsing
// lives server-side (functions/tempLogic.js extractWaterSample); the client
// only maps the numeric codes to a severity level and decides whether the
// sample is fresh enough to show.

/** How a value should be coloured: neutral-good, mild warning, or a real
 *  "don't swim" signal. `muted` = known-but-unremarkable (e.g. "no data"). */
export type QualitySeverity = "ok" | "warn" | "bad" | "muted";

/** Sample verdict: 1 suitable · 2 with remarks · 3 unfit · 4 no data. */
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

// Official bathing samples are taken roughly biweekly, so a 1-week gate would
// blank out every spot for half of each cycle. Show the latest sample for up
// to ~2 weeks — matches QUALITY_MAX_AGE_MS in the sweep, which stops storing
// samples older than this. Older than that is treated as "no current sample".
export const SAMPLE_FRESH_MS = 14 * 24 * 60 * 60 * 1000;

export function isSampleFresh(
  at: number | undefined,
  now: number = Date.now(),
): boolean {
  return typeof at === "number" && now - at <= SAMPLE_FRESH_MS;
}
