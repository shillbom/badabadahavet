import { lazy } from "react";

/**
 * Route-level code splitting + post-login preload config.
 *
 * Each page is registered once below. The order matters: it controls
 * the priority in which preload happens after login (Map first since
 * it's already shown, Recap last because it's the heaviest chunk).
 */
const PAGES = [
  { key: "Map", load: () => import("@/views/MapPage") },
  {
    key: "History",
    load: () => import("@/views/HistoryPage"),
  },
  {
    key: "Leaderboard",
    load: () => import("@/views/LeaderboardPage"),
  },
  { key: "Log", load: () => import("@/views/LogSessionPage") },
  {
    key: "EditSwim",
    load: () => import("@/views/EditSwimPage"),
  },
  { key: "Groups", load: () => import("@/views/GroupsPage") },
  { key: "Spot", load: () => import("@/views/SpotPage") },
  {
    key: "Achievements",
    load: () => import("@/views/AchievementsPage"),
  },
  {
    key: "Streak",
    load: () => import("@/views/StreakPage"),
  },
  {
    key: "Profile",
    load: () => import("@/views/ProfilePage"),
  },
  { key: "About", load: () => import("@/views/AboutPage") },
  {
    key: "Privacy",
    load: () => import("@/views/PrivacyPage"),
  },
  { key: "Recap", load: () => import("@/views/RecapPage") },
  { key: "Toswim", load: () => import("@/views/ToswimPage") },
  {
    key: "AdminUsers",
    load: () => import("@/views/AdminUsersPage"),
  },
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
