/**
 * Share-card text for a spot page — the pure half of what the retired
 * `spotPreview` Cloud Function built by string concatenation. Next's
 * `generateMetadata` now emits the tags (see
 * app/(app)/spot/[placeId]/page.tsx); this module owns only the wording, so
 * the copy stays testable without a Firestore or a request.
 *
 * The text is Swedish, unconditionally. Link-preview scrapers send no useful
 * language signal, the app is Swedish-first (`og:locale: sv_SE`), and the
 * previous function was Swedish-only — so this is the same output, not a
 * regression. Localised UI text belongs in src/lib/i18n.ts, which is a client
 * store and cannot run here.
 */

/** Collapse whitespace and clip to `max` chars on a word boundary, adding an
 *  ellipsis — keeps long spot descriptions from overflowing the card. */
export function truncateShareText(value: unknown, max: number): string {
  const s = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const body = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return body.replace(/[\s.,;:!?–-]+$/, "") + "…";
}

/** Site-level defaults, used when the place id is unknown or deleted so a
 *  stale shared link still previews as the app itself. */
export const SITE_SHARE_TITLE = "Badligan – en liten, vänlig badtävling";
export const SITE_SHARE_DESCRIPTION =
  "Logga dina bad, samla badplatser på kartan, lås upp utmärkelser och tävla med vänner om poäng.";

export type SpotShareInput = {
  name: string;
  /** The spot's own description, if it has one. */
  info?: string | null;
  /** Latest water temperature in °C, or null when nothing is known. */
  temp?: number | null;
  /** Total swims logged at the spot. */
  swimCount?: number;
};

export type SpotShare = { title: string; description: string };

/**
 * Title + description for one spot. Mirrors the old function's shape: lead
 * with the spot's own description when it has one, then the stats line, and
 * fall back to the generic pitch when we know nothing but the name.
 */
export function buildSpotShare({
  name,
  info,
  temp,
  swimCount = 0,
}: SpotShareInput): SpotShare {
  const title = `${name} på Badligan`;

  // "18.3 °C i vattnet · 42 bad" — matches how the app renders both.
  const stats: string[] = [];
  if (typeof temp === "number" && Number.isFinite(temp)) {
    stats.push(`${temp.toFixed(1)} °C i vattnet`);
  }
  if (swimCount > 0) stats.push(`${swimCount} bad`);
  const statLine = stats.join(" · ");

  const infoText = typeof info === "string" ? truncateShareText(info, 160) : "";
  if (infoText) {
    return {
      title,
      description: statLine ? `${infoText} · ${statLine}` : infoText,
    };
  }
  return {
    title,
    description: statLine
      ? `${statLine} · Kolla in ${name} på Badligan.`
      : `Kolla in ${name} på Badligan – logga dina bad, samla badplatser på kartan och tävla med vänner om poäng.`,
  };
}
