// Countries supported by the home-country picker. Limited to Nordic +
// Baltic since the seasonal cold-water brackets only make sense in
// climates where winter is genuinely cold. "OTHER" is a sentinel for
// users living elsewhere — their swims count as category-A home swims
// (1 pt) regardless of month.
export const COUNTRIES: { code: string; name: string }[] = [
  { code: "SE", name: "Sverige" },
  { code: "NO", name: "Norge" },
  { code: "DK", name: "Danmark" },
  { code: "FI", name: "Suomi" },
  { code: "IS", name: "Ísland" },
  { code: "EE", name: "Eesti" },
  { code: "LV", name: "Latvija" },
  { code: "LT", name: "Lietuva" },
  { code: "OTHER", name: "Övrigt / Other" },
];

/** Countries cold enough for the B/C/D winter brackets to apply. */
export const COLD_CLIMATE_COUNTRIES = new Set([
  "SE",
  "NO",
  "DK",
  "FI",
  "IS",
  "EE",
  "LV",
  "LT",
]);

/** Convert a 2-letter country code to its flag emoji (regional indicators). */
export function flagEmoji(code: string): string {
  if (code === "OTHER") return "🌍";
  if (!/^[A-Za-z]{2}$/.test(code)) return "🏳️";
  const A = 0x1f1e6;
  const a = "A".charCodeAt(0);
  const cc = code.toUpperCase();
  return (
    String.fromCodePoint(A + (cc.charCodeAt(0) - a)) +
    String.fromCodePoint(A + (cc.charCodeAt(1) - a))
  );
}

export function detectBrowserCountry(): string | null {
  if (typeof navigator === "undefined") return null;
  const langs = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];
  for (const l of langs) {
    const m = /[-_]([A-Za-z]{2})$/.exec(l ?? "");
    if (m) return m[1].toUpperCase();
  }
  return null;
}

/** Map a real ISO country code to a picker option. Anything outside the
 *  curated list becomes "OTHER". */
export function pickerCodeFor(real: string | null): string {
  if (!real) return "SE";
  const upper = real.toUpperCase();
  return COUNTRIES.some((c) => c.code === upper) ? upper : "OTHER";
}
