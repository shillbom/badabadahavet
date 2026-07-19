import { useAuth } from "@/auth/AuthContext";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { m } from "framer-motion";
import { ListChecks, MapIcon, Trophy, UsersRound } from "lucide-react";
import { NavLink } from "react-router";

export default function NavBar() {
  const { user } = useAuth();
  const isGuest = !user;

  const t = useT();

  return (
    <m.nav
      key="nav"
      initial={{ y: 80 }}
      animate={{ y: 0 }}
      exit={{ y: 80 }}
      transition={{ type: "spring", stiffness: 280, damping: 28 }}
      className="t-4 fixed inset-x-0 bottom-0 z-[1000] mx-auto flex max-w-md justify-around border-t border-white/70 bg-white/85 px-4 pt-2 pb-[max(env(safe-area-inset-bottom),0.5rem)] backdrop-blur md:bottom-4 md:rounded-3xl md:border md:pb-2 md:shadow-xl md:shadow-wave-900/10"
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
