import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SpotView } from "@/views/SpotPage";
import { SHARE_LOGO_URL, SITE_ORIGIN } from "@/lib/site";
import { loadSpotSnapshot } from "@/server/spotData";
import {
  buildSpotShare,
  SITE_SHARE_DESCRIPTION,
  SITE_SHARE_TITLE,
} from "@/server/spotShare";

/**
 * `/spot/[placeId]` — the one page in the app that is genuinely public,
 * linkable and indexable, and the reason the Next migration happened.
 *
 * It is a SERVER component: it reads the spot from Firestore with
 * firebase-admin (src/server/spotData.ts), emits the per-place
 * title/description/OG/Twitter tags that the retired `spotPreview` Cloud
 * Function used to assemble by hand, and hands the same data to the client
 * view as `initial` so the name, info text, temperature, stats and recent
 * swims are in the HTML — for scrapers, for search engines, and for first
 * paint. The live parts (reactions, add-to-swim, temp refresh, the sessions
 * listener) hydrate on top of that exact markup; nothing is duplicated,
 * because the client view renders from the same props on both sides.
 *
 * `spotPreview` had to sniff user agents to decide whether to serve tags or
 * bounce the visitor into the SPA. There is nothing to sniff any more: every
 * visitor, human or robot, gets the same real page.
 */

// firebase-admin needs Node, not the Edge runtime.
export const runtime = "nodejs";

/**
 * Cache each rendered spot page for an hour. This is what keeps the read cost
 * flat: a crawler walking all ~5.4k spot URLs (or a link doing the rounds in a
 * group chat) pays four Firestore reads per spot per hour, not per request.
 * The routes that write a spot's content — /api/logSession, /api/removeSession
 * and /api/setPlaceInfo — call revalidatePath("/spot/<id>") so an edit or a
 * fresh swim shows up immediately rather than waiting out the hour.
 */
export const revalidate = 3600;

/**
 * Returning no params is what opts this dynamic segment into that cache
 * without prebuilding ~5.4k pages: nothing is rendered at build time, each
 * spot is rendered on its first request and then served from the cache until
 * it is revalidated. Without a `generateStaticParams` at all, Next treats the
 * route as fully dynamic and re-reads Firestore on every single request —
 * which is exactly the fan-out this page is supposed to avoid.
 */
export function generateStaticParams() {
  return [];
}

type PageProps = { params: Promise<{ placeId: string }> };

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { placeId } = await params;
  const { place, failed, swimCount, reading, photoUrl } =
    await loadSpotSnapshot(placeId);

  // An id that doesn't exist renders the not-found boundary (app/not-found.tsx
  // — which moves a human home, the app's long-standing behaviour for an
  // unknown path). A failed *read* deliberately does not: it falls through to
  // the client, which fetches the place itself (see the page below).
  //
  // Raised from generateMetadata as well as from the page because this runs
  // first — but note it does NOT currently change the status code: Layout
  // wraps the routed page in its own <Suspense> (src/components/Layout.tsx),
  // so the shell is streamed with a 200 before this route can resolve, and
  // the status is then fixed. Verified: dropping that boundary makes this a
  // real 404. Keeping the call anyway — the boundary is the right UI either
  // way, and the status corrects itself if that <Suspense> ever moves.
  if (!place && !failed) notFound();

  // Canonical is /spot/<id>: /s/<id> is the share entrypoint but 308s here,
  // and pointing two URLs at one page splits the crawl budget.
  const canonical = `/spot/${encodeURIComponent(placeId)}`;
  const url = `${SITE_ORIGIN}${canonical}`;

  // An unknown or deleted id still previews as the app itself — a stale
  // shared link showing the site card beats showing nothing.
  const { title, description } = place
    ? buildSpotShare({
        name: place.name,
        info: place.info,
        temp: reading?.t ?? null,
        swimCount,
      })
    : { title: SITE_SHARE_TITLE, description: SITE_SHARE_DESCRIPTION };

  // A swim photo makes a proper wide card; the square logo does not.
  const image = photoUrl ?? SHARE_LOGO_URL;
  const large = Boolean(photoUrl);

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      // "article" would claim a byline and a publish date the page hasn't
      // got; a spot page is a place, not a post.
      type: "website",
      siteName: "Badligan",
      title,
      description,
      url,
      locale: "sv_SE",
      images: [{ url: image }],
    },
    twitter: {
      card: large ? "summary_large_image" : "summary",
      title,
      description,
      images: [image],
    },
  };
}

export default async function Page({ params }: PageProps) {
  const { placeId } = await params;
  const snapshot = await loadSpotSnapshot(placeId);

  // Same guard as generateMetadata's (this render is reached even though that
  // one already bailed, because metadata and the page are separate calls).
  if (!snapshot.place && !snapshot.failed) notFound();

  return (
    <SpotView
      placeId={placeId}
      variant="page"
      initial={
        snapshot.place
          ? {
              place: snapshot.place,
              sessions: snapshot.sessions,
              swimCount: snapshot.swimCount,
              reading: snapshot.reading,
            }
          : undefined
      }
    />
  );
}
