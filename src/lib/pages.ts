/**
 * Post-login route warm-up.
 *
 * Route-level code splitting itself is Next's job now (one client bundle per
 * `app/**\/page.tsx`), so the lazy-import table this file used to hold is
 * gone — and with it `withStaleReload`, whose chunk-404 guard existed for
 * Vite's content-hashed chunks plus the retired service worker.
 *
 * What survives is the *ordering intent*: warm the routes a signed-in user is
 * most likely to hit next, cheapest-and-soonest first. Map leads (it's the
 * page already on screen, so its bundle is free) and Recap trails (heaviest
 * bundle, rarest visit). `router.prefetch` pulls each route's RSC payload and
 * client bundle into Next's cache; it's idempotent and a no-op once cached.
 */

/** Routes to warm after login, in priority order. */
const PREFETCH_ROUTES = [
  "/",
  "/history",
  "/leaderboard",
  "/log",
  "/groups",
  "/achievements",
  "/streak",
  "/profile",
  "/about",
  "/privacy",
  "/toswim",
  "/recap",
] as const;

type Prefetcher = { prefetch: (href: string) => void };

/**
 * Prefetch every warm-up route in order. Runs in idle time so it doesn't
 * fight the initial render. Returns a cancel function for effect cleanup.
 *
 * Note: `/spot/[placeId]`, `/swim/[sessionId]/edit` and `/admin/users` are
 * deliberately absent — the first two are per-id (nothing to warm without
 * knowing which), and admin is a route almost nobody opens.
 */
export function prefetchAllPages(router: Prefetcher): () => void {
  const ric: (cb: () => void) => number =
    (
      window as unknown as {
        requestIdleCallback?: (cb: () => void) => number;
      }
    ).requestIdleCallback ?? ((cb) => window.setTimeout(cb, 600));
  const handle = ric(() => {
    for (const route of PREFETCH_ROUTES) {
      try {
        router.prefetch(route);
      } catch {
        /* prefetch is best-effort */
      }
    }
  });
  return () => {
    const cic = (
      window as unknown as { cancelIdleCallback?: (h: number) => void }
    ).cancelIdleCallback;
    if (cic) cic(handle);
    else window.clearTimeout(handle);
  };
}
