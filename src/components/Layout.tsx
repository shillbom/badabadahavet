import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { m, AnimatePresence } from "framer-motion";
import {
  Map as MapIcon,
  Trophy,
  Plus,
  ListChecks,
  UsersRound,
} from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useStore } from "@/store/sessions";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import TopBar from "@/components/TopBar";
import SwimNudge from "@/components/SwimNudge";
import DiscoRays from "@/components/DiscoRays";

export default function Layout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const t = useT();
  const myStats = useStore((s) => s.myStats);

  const [nudgeOpen, setNudgeOpen] = useState(false);

  // Hide the bottom nav + FAB on full-screen story-style routes so they
  // don't fight with the slide content — and on the swim log/edit forms,
  // whose submit buttons would otherwise sit behind them.
  const hideChrome =
    location.pathname.startsWith("/recap") ||
    location.pathname.startsWith("/log") ||
    location.pathname.startsWith("/swim/");

  const isGuest = !user;

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
  const isMapPage = location.pathname === "/";

  // Desktop: the top bar always spans the full viewport; it's the phone
  // content column below it that relaxes per route. The map gets the whole
  // viewport (maps want space), story-style recap stays phone-shaped, and
  // everything else widens to a comfortable reading column.
  const isRecap = location.pathname.startsWith("/recap");
  const contentWidth = isMapPage
    ? "max-w-md lg:max-w-none"
    : isRecap
      ? "max-w-md"
      : "max-w-md lg:max-w-2xl";

  return (
    <div className="relative mx-auto flex h-[var(--app-height,100dvh)] w-full flex-col overflow-hidden">
      <TopBar onNudge={() => setNudgeOpen(true)} />

      <main
        className={cn(
          "relative flex flex-1 flex-col overflow-x-hidden",
          isMapPage ? "overflow-hidden" : "overflow-y-auto",
        )}
      >
        {/* Per-page entrance animations live in each page; we no longer
            wrap the Outlet in AnimatePresence because under StrictMode
            mid-flight exits could leave the next page at opacity 0. */}
        <m.div
          key={location.pathname}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className={cn(
            "mx-auto w-full md:border-x md:border-white/60 md:bg-white/30 md:shadow-[0_0_40px_-10px_rgba(2,100,160,0.18)] md:backdrop-blur-sm",
            contentWidth,
            isMapPage
              ? "flex min-h-0 flex-1 flex-col"
              : hideChrome
                ? "min-h-full pb-4"
                : // Clear the fixed bottom nav + the FAB poking above it, plus
                  // the home-indicator inset the nav itself grows by on iOS —
                  // otherwise the end of long pages (e.g. the groups list)
                  // hides behind the bar.
                  "min-h-full pb-[calc(env(safe-area-inset-bottom)+9rem)]",
          )}
        >
          <Suspense
            fallback={
              <div className="flex h-40 items-center justify-center">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-wave-600 border-r-transparent" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </m.div>
      </main>

      <AnimatePresence>
        {!hideChrome && !isGuest ? (
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
              onClick={() => navigate("/log")}
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

      <AnimatePresence>
        {!hideChrome ? (
          <m.nav
            key="nav"
            initial={{ y: 80 }}
            animate={{ y: 0 }}
            exit={{ y: 80 }}
            transition={{ type: "spring", stiffness: 280, damping: 28 }}
            className="fixed inset-x-0 bottom-0 z-[1000] mx-auto flex max-w-md justify-around border-t border-white/70 bg-white/85 px-4 pt-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] backdrop-blur md:bottom-4 md:rounded-3xl md:border md:pb-2 md:shadow-xl md:shadow-wave-900/10"
          >
            <NavTab
              to="/"
              label={t("nav.map")}
              icon={<MapIcon className="h-5 w-5" />}
            />
            {!isGuest ? (
              <NavTab
                to="/toswim"
                label={t("nav.toswim")}
                icon={<ListChecks className="h-5 w-5" />}
              />
            ) : null}
            {!isGuest ? <span className="w-14" aria-hidden /> : null}
            <NavTab
              to="/leaderboard"
              label={t("nav.top")}
              icon={<Trophy className="h-5 w-5" />}
            />
            {!isGuest ? (
              <NavTab
                to="/groups"
                label={t("nav.groups")}
                icon={<UsersRound className="h-5 w-5" />}
              />
            ) : null}
          </m.nav>
        ) : null}
      </AnimatePresence>

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

function NavTab({
  to,
  label,
  icon,
}: {
  to: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      className={({ isActive }) =>
        cn(
          "relative flex w-12 flex-col items-center gap-0.5 rounded-2xl px-4 py-2 text-[10px] font-medium transition-colors",
          isActive ? "text-wave-700" : "text-slate-400 hover:text-slate-600",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <m.span
              layoutId="nav-active-pill"
              className="absolute inset-0 -z-10 rounded-2xl bg-wave-100/80 ring-1 ring-wave-200"
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
            />
          ) : null}
          <m.span
            animate={isActive ? { y: -1, scale: 1.05 } : { y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 360, damping: 24 }}
          >
            {icon}
          </m.span>
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}
