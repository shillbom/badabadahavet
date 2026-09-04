// Bucket a timestamp into a YYYY-MM-DD day key in Sweden's local zone.
// Water temps are attributed to the day the swim happened *locally* — using
// UTC (toISOString) would push a late-evening Swedish swim (CEST = UTC+2)
// into the next day's bucket. Scoring stays on swimYear()/UTC on purpose;
// this is only for the human-facing temperature day key.
export const localDay = (ms: number): string =>
  new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
