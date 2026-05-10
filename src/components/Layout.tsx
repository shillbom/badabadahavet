import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { LogOut, Map as MapIcon, History, Trophy, Plus } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default function Layout() {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const t = useT();

  const groupCount = profile?.groups.length ?? 0;
  const groupSubtitle =
    groupCount === 0
      ? t("layout.solo_swimmer")
      : groupCount === 1
        ? t("layout.groups_one")
        : t("layout.groups_many", { n: groupCount });

  return (
    <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-md flex-col">
      <header className="sticky top-0 z-30 flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{profile?.emoji ?? "🌊"}</span>
          <div>
            <div className="font-display text-base font-bold leading-none text-wave-900">
              {profile?.displayName ?? t("layout.swimmer")}
            </div>
            <div className="text-[11px] text-wave-700/70">{groupSubtitle}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <button
            onClick={() => logout()}
            className="rounded-full bg-white/70 p-2 text-slate-600 ring-1 ring-slate-200 hover:bg-white"
            aria-label={t("layout.log_out")}
            title={t("layout.log_out")}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-32">
        <Outlet />
      </main>

      <motion.button
        whileTap={{ scale: 0.93 }}
        whileHover={{ scale: 1.03 }}
        onClick={() => navigate("/log")}
        className={cn(
          "fixed bottom-[max(env(safe-area-inset-bottom),5.25rem)] left-1/2 z-40 -translate-x-1/2",
          "flex h-14 w-14 items-center justify-center rounded-full",
          "bg-wave-600 text-white shadow-xl shadow-wave-800/40",
          "ring-4 ring-white/70",
        )}
        aria-label={t("layout.log_a_swim")}
      >
        <Plus className="h-6 w-6" />
      </motion.button>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-md justify-around border-t border-white/70 bg-white/80 px-4 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur"
      >
        <NavTab
          to="/"
          label={t("nav.map")}
          icon={<MapIcon className="h-5 w-5" />}
        />
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
      </nav>
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
          "flex w-12 flex-col items-center gap-0.5 text-[10px] font-medium text-slate-400",
          isActive && "text-wave-700",
        )
      }
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  );
}
