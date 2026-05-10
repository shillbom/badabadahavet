import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { LogOut, Map as MapIcon, History, Trophy, Plus } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default function Layout() {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const t = useT();

  const groupCount = profile?.groups.length ?? 0;
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

  return (
    <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-md flex-col">
      <header className="sticky top-0 z-30 flex items-center justify-between bg-gradient-to-b from-white/80 to-transparent px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-2 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 22 }}
          className="flex items-center gap-2"
        >
          <span className="text-2xl">{profile?.emoji ?? "🌊"}</span>
          <div>
            <div className="font-display text-base font-bold leading-none text-wave-900">
              {profile?.displayName ?? t("layout.swimmer")}
            </div>
            <div className="text-[11px] text-wave-700/70">{groupSubtitle}</div>
          </div>
        </motion.div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <button
            onClick={() => logout()}
            className="rounded-full bg-white/70 p-2 text-slate-600 ring-1 ring-slate-200 transition hover:bg-white active:scale-95"
            aria-label={t("layout.log_out")}
            title={t("layout.log_out")}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="relative flex-1 overflow-y-auto pb-32">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {!hideChrome ? (
          <motion.button
            key="fab"
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
            whileTap={{ scale: 0.92 }}
            whileHover={{ scale: 1.04 }}
            onClick={() => navigate("/log")}
            className={cn(
              "fixed bottom-[max(env(safe-area-inset-bottom),5.25rem)] left-1/2 z-40 -translate-x-1/2",
              "flex h-14 w-14 items-center justify-center rounded-full",
              "bg-gradient-to-br from-wave-500 to-wave-700 text-white shadow-xl shadow-wave-800/40",
              "ring-4 ring-white/70",
            )}
            aria-label={t("layout.log_a_swim")}
          >
            <span
              aria-hidden
              className="absolute inset-0 rounded-full bg-wave-400/40 blur-md"
            />
            <Plus className="relative h-6 w-6" />
          </motion.button>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {!hideChrome ? (
          <motion.nav
            key="nav"
            initial={{ y: 80 }}
            animate={{ y: 0 }}
            exit={{ y: 80 }}
            transition={{ type: "spring", stiffness: 280, damping: 28 }}
            className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-md justify-around border-t border-white/70 bg-white/85 px-4 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur"
          >
            <NavTab to="/" label={t("nav.map")} icon={<MapIcon className="h-5 w-5" />} />
            <NavTab
              to="/history"
              label={t("nav.history")}
              icon={<History className="h-5 w-5" />}
            />
            <span className="w-14" aria-hidden />
            <NavTab
              to="/leaderboard"
              label={t("nav.top")}
              icon={<Trophy className="h-5 w-5" />}
            />
            <NavTab
              to="/groups"
              label={t("nav.groups")}
              icon={<span className="text-base">👥</span>}
            />
          </motion.nav>
        ) : null}
      </AnimatePresence>
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
          "relative flex w-12 flex-col items-center gap-0.5 rounded-2xl px-1 py-1 text-[10px] font-medium transition-colors",
          isActive ? "text-wave-700" : "text-slate-400 hover:text-slate-600",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <motion.span
              layoutId="nav-active-pill"
              className="absolute inset-0 -z-10 rounded-2xl bg-wave-100/80 ring-1 ring-wave-200"
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
            />
          ) : null}
          <motion.span
            animate={isActive ? { y: -1, scale: 1.05 } : { y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 360, damping: 24 }}
          >
            {icon}
          </motion.span>
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}
