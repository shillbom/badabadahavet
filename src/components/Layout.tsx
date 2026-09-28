"use client";

import { usePathname, useRouter } from "next/navigation";
import { m, AnimatePresence } from "framer-motion";
import { Plus } from "lucide-react";
import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useStore } from "@/store/sessions";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import TopBar from "@/components/TopBar";
import SwimNudge from "@/components/SwimNudge";
import DiscoRays from "@/components/fx/DiscoRays";
import { getBootReady, subscribeBootReady } from "@/lib/bootSignal";
import NavBar from "./NavBar";

/**
 * The authed app chrome: top bar, scrolling content column, FAB and bottom
 * nav. Mounted by `app/(app)/layout.tsx`, so `children` is the matched route's
 * page — it used to be react-router's <Outlet />.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();
  const myStats = useStore((s) => s.myStats);

  const [nudgeOpen, setNudgeOpen] = useState(false);

  // The top and bottom bars depend on who is signed in, which isn't known
  // until boot finishes (and never on the server). Normally the boot splash
  // covers that; on a landing that skips it (a /spot/* page, see AppBoot)
  // showing them early would flash the guest variant first. So they wait for
  // the boot signal — the top bar keeps its space meanwhile, so the content
  // doesn't jump when it fades in.
  const chromeReady = useSyncExternalStore(
    subscribeBootReady,
    getBootReady,
    getBootReady,
  );

  // Skip the page entrance on the very first render: the server HTML would
  // otherwise ship the content at opacity 0 and keep it invisible until JS
  // runs. Route changes after that still animate.
  const [animateEntrance, setAnimateEntrance] = useState(false);
  useEffect(() => setAnimateEntrance(true), []);

  // Hide the bottom nav + FAB on full-screen story-style routes so they
  // don't fight with the slide content — and on the swim log/edit forms,
  // whose submit buttons would otherwise sit behind them.
  const hideChrome =
    pathname.startsWith("/recap") ||
    pathname.startsWith("/log") ||
    pathname.startsWith("/swim/");

  const isGuest = !user;

  // A guest on a spot page (typically arriving from search or a shared link)
  // gets the page without the bottom nav: its tabs lead to screens that are
  // empty or sign-in walls for them, and the top bar already offers sign-in.
  const hideNav = hideChrome || (isGuest && pathname.startsWith("/spot/"));

  // Last-chance nudge: when the streak dies unless the user swims today,
  // suggest the nearest new spot — once per calendar day, and only after
  // the page has settled so it doesn't fight the since-last-visit digest.
  const atRisk = myStats.streak.atRisk;
  useEffect(() => {
    if (!user || !atRisk) return;
    const key = `nudge-shown-${new Date().toDateString()}`;
    if (localStorage.getItem(key)) return;
    const timer = setTimeout(() => {
      localStorage.setItem(key, "1");
      setNudgeOpen(true);
    }, 2500);
    return () => clearTimeout(timer);
  }, [user, atRisk]);

  // The map page is non-scrolling — the map fills available space. Remove
  // the bottom padding so it doesn't create dead scroll space below the map.
  const isMapPage = pathname === "/";

  // Desktop: the top bar always spans the full viewport; it's the phone
  // content column below it that relaxes per route. The map gets the whole
  // viewport (maps want space), story-style recap stays phone-shaped, and
  // everything else widens to a comfortable reading column.
  const isRecap = pathname.startsWith("/recap");
  const contentWidth = isMapPage
    ? "max-w-md lg:max-w-none"
    : isRecap
      ? "max-w-md"
      : "max-w-md lg:max-w-2xl";

  return (
    <div className="relative mx-auto flex h-[var(--app-height,100dvh)] w-full flex-col overflow-hidden">
      <div
        className={cn(
          "sticky top-0 z-[1000] flex-none transition-opacity duration-200",
          chromeReady ? "opacity-100" : "invisible opacity-0",
        )}
      >
        <TopBar onNudge={() => setNudgeOpen(true)} />
      </div>

      <main
        className={cn(
          "relative flex min-h-0 flex-1 flex-col overflow-x-hidden",
          isMapPage ? "overflow-hidden" : "overflow-y-auto",
        )}
      >
        {/* Per-page entrance animations live in each page; we no longer
            wrap the page in AnimatePresence because under StrictMode
            mid-flight exits could leave the next page at opacity 0. */}
        <m.div
          key={pathname}
          initial={animateEntrance ? { opacity: 0, y: 6 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className={cn(
            "mx-auto w-full md:border-x md:border-white/60 md:bg-white/30 md:shadow-[0_0_40px_-10px_rgba(2,100,160,0.18)] md:backdrop-blur-sm",
            contentWidth,
            isMapPage
              ? "flex min-h-0 flex-1 flex-col"
              : hideNav
                ? "min-h-full shrink-0 pb-4"
                : "min-h-full shrink-0",
          )}
        >
          <Suspense
            fallback={
              <div className="flex h-40 items-center justify-center">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-wave-600 border-r-transparent" />
              </div>
            }
          >
            {children}
          </Suspense>
        </m.div>
      </main>

      {!isMapPage && !hideNav ? (
        // Keep the scroll viewport above the fixed nav and its protruding FAB.
        // As a flex row this combines with TopBar's real rendered height,
        // rather than guessing both chrome heights inside every page.
        <div
          aria-hidden
          className="h-[calc(max(env(safe-area-inset-bottom),1.5rem)+4.5rem)] flex-none md:h-28"
        />
      ) : null}

      <AnimatePresence>
        {chromeReady && !hideChrome && !isGuest ? (
          <div
            key="fab-shell"
            className="pointer-events-none fixed inset-x-0 bottom-[max(env(safe-area-inset-bottom),1.5rem)] z-[1010] mx-auto flex max-w-md justify-center md:bottom-10"
          >
            <m.button
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
              whileTap={{ scale: 0.92 }}
              whileHover={{ scale: 1.04 }}
              onClick={() => router.push("/log")}
              className={cn(
                "pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full",
                "bg-gradient-to-br from-wave-500 to-wave-700 text-white shadow-xl shadow-wave-800/40",
                "ring-4 ring-white/70",
              )}
              aria-label={t("layout.log_a_swim")}
            >
              <Plus className="relative h-6 w-6" />
            </m.button>
          </div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>{chromeReady && !hideNav && <NavBar />}</AnimatePresence>

      <SwimNudge
        open={nudgeOpen}
        onClose={() => setNudgeOpen(false)}
        atRisk={atRisk}
        streakDays={myStats.streak.current}
      />

      {/* 50+ day streak: the mega-disco rays cover the whole app (self-gating). */}
      <DiscoRays />
    </div>
  );
}
