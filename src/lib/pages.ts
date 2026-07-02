import { lazy } from "react";

/**
 * If a lazy chunk import fails (e.g. old hash no longer on the CDN after
 * a redeploy), reload once to pick up the new SW-cached assets.
 */
function withStaleReload<T>(load: () => Promise<T>): () => Promise<T> {
  return async () => {
    try {
      return await load();
    } catch {
      // Guard against infinite reload loops.
      if (!sessionStorage.getItem("chunk-reload")) {
        sessionStorage.setItem("chunk-reload", "1");
        window.location.reload();
      }
      return load();
    }
  };
}

/**
 * Route-level code splitting + post-login preload config.
 *
 * Each page is registered once below. The order matters: it controls
 * the priority in which preload happens after login (Map first since
 * it's already shown, Recap last because it's the heaviest chunk).
 */
const PAGES = [
  { key: "Map", load: withStaleReload(() => import("@/pages/MapPage")) },
  {
    key: "History",
    load: withStaleReload(() => import("@/pages/HistoryPage")),
  },
  {
    key: "Leaderboard",
    load: withStaleReload(() => import("@/pages/LeaderboardPage")),
  },
  { key: "Log", load: withStaleReload(() => import("@/pages/LogSessionPage")) },
  { key: "Groups", load: withStaleReload(() => import("@/pages/GroupsPage")) },
  { key: "Spot", load: withStaleReload(() => import("@/pages/SpotPage")) },
  {
    key: "Achievements",
    load: withStaleReload(() => import("@/pages/AchievementsPage")),
  },
  {
    key: "Streak",
    load: withStaleReload(() => import("@/pages/StreakPage")),
  },
  {
    key: "Profile",
    load: withStaleReload(() => import("@/pages/ProfilePage")),
  },
  { key: "About", load: withStaleReload(() => import("@/pages/AboutPage")) },
  { key: "Recap", load: withStaleReload(() => import("@/pages/RecapPage")) },
  { key: "Toswim", load: withStaleReload(() => import("@/pages/ToswimPage")) },
] as const;

type PageKey = (typeof PAGES)[number]["key"];

const lazyByKey = Object.fromEntries(
  PAGES.map((p) => [p.key, lazy(p.load)]),
) as unknown as Record<PageKey, ReturnType<typeof lazy>>;

export const Pages = lazyByKey;

/**
 * Warm up every page chunk in the browser's module cache. Idempotent:
 * once a chunk is loaded it stays loaded; subsequent calls are no-ops.
 * Runs in idle time so it doesn't fight with the initial render.
 */
export function preloadAllPages(): () => void {
  const ric: (cb: () => void) => number =
    (
      window as unknown as {
        requestIdleCallback?: (cb: () => void) => number;
      }
    ).requestIdleCallback ?? ((cb) => window.setTimeout(cb, 600));
  const handle = ric(() => {
    for (const { load } of PAGES) {
      void load().catch(() => {});
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
