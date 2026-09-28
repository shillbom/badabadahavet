/**
 * schema.org structured data for a spot page — the pure half of the
 * `<script type="application/ld+json">` that app/(app)/spot/[placeId]/page.tsx
 * renders.
 *
 * A spot is described as a `Beach` (a schema.org Place): name, coordinates,
 * the canonical URL and the description. Google has no rich result for
 * beaches, so this won't change how a result looks; what it buys is entity
 * identity. `sameAs` points at the official page for the same bathing spot
 * (HaV's badplatsen for imported spots, via `infoUrl`), which tells a search
 * engine both pages describe one real place — the structured-data form of the
 * "Källa: havochvatten.se" link the page already shows.
 *
 * `sameAs` comes only from official info: user-contributed text has no
 * `infoUrl`, and a user-supplied link must never be asserted as the identity
 * of the place.
 */

import type { PlaceDoc } from "@/lib/types";
import { truncateShareText } from "@/server/spotShare";

type SpotJsonLdPlace = Pick<
  PlaceDoc,
  "name" | "lat" | "lng" | "info" | "infoSource" | "infoUrl"
>;

export function buildSpotJsonLd(
  place: SpotJsonLdPlace,
  url: string,
): Record<string, unknown> {
  const description = place.info ? truncateShareText(place.info, 500) : "";
  const sameAs =
    place.infoSource !== "user" &&
    typeof place.infoUrl === "string" &&
    place.infoUrl.startsWith("https://")
      ? place.infoUrl
      : null;
  const hasGeo = Number.isFinite(place.lat) && Number.isFinite(place.lng);

  return {
    "@context": "https://schema.org",
    "@type": "Beach",
    name: place.name,
    url,
    ...(description && { description }),
    ...(hasGeo && {
      geo: {
        "@type": "GeoCoordinates",
        latitude: place.lat,
        longitude: place.lng,
      },
    }),
    ...(sameAs && { sameAs }),
  };
}

/** JSON for inlining in a `<script>`: `<` is escaped so text like
 *  `</script>` in a spot description can't close the tag early. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
