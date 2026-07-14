import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { m, AnimatePresence } from "framer-motion";
import {
  Map as MapIcon,
  Trophy,
  Plus,
  ListChecks,
  LogIn,
  History,
  Info,
  UsersRound,
  WavesLadder,
} from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { useStore } from "@/store/sessions";
import { useIsAdmin } from "@/lib/adminMode";
import { openRecap } from "@/components/recapTrigger";
import { cn, rememberReturnPath } from "@/lib/utils";
import { buttonClasses } from "@/components/ui/buttonStyles";
import { useT } from "@/lib/i18n";
import SwimNudge from "@/components/SwimNudge";
import DiscoRays from "@/components/DiscoRays";

export default function Layout() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const t = useT();
  const isAdmin = useIsAdmin();
  const myStats = useStore((s) => s.myStats);

  const [nudgeOpen, setNudgeOpen] = useState(false);

  const groupCount = useStore((s) => s.groups.length);
  const groupSubtitle =
    groupCount === 0
      ? t("layout.solo_swimmer")
      : groupCount === 1
        ? t("layout.groups_one")
        : t("layout.groups_many", { n: groupCount });

  // Hide the bottom nav + FAB on full-screen story-style routes so they
  // don't fight with the slide content.
  const hideChrome =
    location.pathname.startsWith("/recap") ||
    location.pathname.startsWith("/log");

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

  // Desktop: the phone-column shell relaxes per route. The map gets the
  // whole viewport (maps want space), story-style recap stays phone-shaped,
  // and everything else widens to a comfortable reading column.
  const isRecap = location.pathname.startsWith("/recap");
  const shellWidth = isMapPage
    ? "max-w-md lg:max-w-none"
    : isRecap
      ? "max-w-md"
      : "max-w-md lg:max-w-2xl";

  return (
    <div
      className={cn(
        "relative mx-auto flex h-[var(--app-height,100dvh)] w-full flex-col overflow-hidden md:border-x md:border-white/60 md:bg-white/30 md:shadow-[0_0_40px_-10px_rgba(2,100,160,0.18)] md:backdrop-blur-sm",
        shellWidth,
      )}
    >
      <header className="sticky top-0 z-[1000] px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3">
        {/* Backdrop fade — a blurred white gradient that extends past the
            header and is masked to dissolve into the content, so there's no
            hard blur/colour seam. Content above stays fully crisp. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[calc(100%+1.75rem)] bg-gradient-to-b from-white/90 via-white/55 to-transparent [mask-image:linear-gradient(to_bottom,black,black_45%,transparent)] backdrop-blur-sm [-webkit-mask-image:linear-gradient(to_bottom,black,black_45%,transparent)]"
        />
        <div className="flex items-center justify-between">
          {isGuest ? (
            <Link
              to="/login"
              onClick={rememberReturnPath}
              className="flex items-center gap-2"
            >
              <m.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ type: "spring", stiffness: 220, damping: 22 }}
                className="flex items-center gap-2"
              >
                <span className="text-2xl">🌊</span>
                <div>
                  <div className="font-display text-base leading-none font-bold text-wave-900">
                    {t("layout.guest")}
                  </div>
                  <div className="text-[11px] text-wave-700/70">
                    {t("layout.guest.subtitle")}
                  </div>
                </div>
              </m.div>
            </Link>
          ) : (
            <Link to="/profile" className="flex items-center gap-2">
              <m.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ type: "spring", stiffness: 220, damping: 22 }}
                className="flex items-center gap-2"
              >
                <span className="text-2xl">{profile?.emoji ?? "🌊"}</span>
                <div>
                  <div className="flex items-center gap-1.5">
                    <div className="font-display text-base leading-none font-bold text-wave-900">
                      {profile?.displayName ?? t("layout.swimmer")}
                    </div>
                    {isAdmin ? (
                      <span
                        className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-white uppercase shadow"
                        title={t("admin.label")}
                      >
                        {t("admin.label")}
                      </span>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-wave-700/70">
                    {groupSubtitle}
                  </div>
                </div>
              </m.div>
            </Link>
          )}
          {isGuest ? (
            <Link
              to="/login"
              onClick={rememberReturnPath}
              className={buttonClasses("primary", "xs")}
            >
              <LogIn className="h-3.5 w-3.5" />
              {t("layout.sign_in")}
            </Link>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setNudgeOpen(true)}
                aria-label={t("map.nudge.button")}
                title={t("map.nudge.button")}
                className="rounded-full bg-white/70 p-2 text-wave-700 ring-1 ring-slate-200 transition hover:bg-white active:scale-95"
              >
                <WavesLadder className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={openRecap}
                aria-label={t("sincevisit.open")}
                title={t("sincevisit.open")}
                className="rounded-full bg-white/70 p-2 text-wave-700 ring-1 ring-slate-200 transition hover:bg-white active:scale-95"
              >
                <History className="h-4 w-4" />
              </button>
              <Link
                to="/about"
                aria-label={t("about.title")}
                title={t("about.title")}
                className="rounded-full bg-white/70 p-2 text-wave-700 ring-1 ring-slate-200 transition hover:bg-white active:scale-95"
              >
                <Info className="h-4 w-4" />
              </Link>
            </div>
          )}
        </div>
      </header>

      <main
        className={cn(
          "relative flex flex-1 flex-col overflow-x-hidden",
          isMapPage
            ? "overflow-hidden"
            : hideChrome
              ? "overflow-y-auto pb-4"
              : "overflow-y-auto pb-32",
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
          className={isMapPage ? "flex min-h-0 flex-1 flex-col" : undefined}
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
