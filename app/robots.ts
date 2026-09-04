import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/site";

/**
 * /robots.txt — replaces the static public/robots.txt.
 *
 * Same intent as before: allow everything, and point at the sitemap. What
 * changed is the reason it can: spot pages used to be exposed to scrapers
 * only through `/s/:placeId`, a UA-sniffing Cloud Function that served meta
 * tags to robots and redirected humans into the SPA. They are now real
 * server-rendered pages at `/spot/:placeId` (see
 * app/(app)/spot/[placeId]/page.tsx), which is also what /sitemap.xml lists;
 * `/s/:placeId` survives only as a 308 for links already in the wild.
 *
 * Nothing is disallowed: the authed pages (/log, /profile, /history…) render
 * as an empty shell without a signed-in user, so there is nothing there for a
 * crawler to index and no need to enumerate them here.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
