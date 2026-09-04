/**
 * The canonical origin. Every absolute URL the server emits — OG tags,
 * canonical links, sitemap entries, robots' `Sitemap:` line — has to agree on
 * one host, or crawlers split the crawl budget between the App Hosting
 * `*.hosted.app` URL, preview channels and the real domain. Hard-coded (not
 * read from a request header) for exactly that reason: a preview deployment
 * must still advertise the production canonical.
 */
export const SITE_ORIGIN = "https://badligan.club";

/** The square logo used as the share-card image when there's no photo. */
export const SHARE_LOGO_URL = `${SITE_ORIGIN}/web-app-manifest-512x512.png`;
