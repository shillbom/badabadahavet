import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useInView } from "framer-motion";
import { Crown, Snowflake, MapPin } from "lucide-react";
import { useStore } from "@/store/sessions";
import { useAuth } from "@/auth/AuthContext";
import type { UserDoc, YearStats } from "@/lib/types";
import { watchUsersByYearScore } from "@/lib/data";
import { resolveBorder, type Border } from "@/lib/borders";
import { useT } from "@/lib/i18n";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { cn } from "@/lib/utils";

type Row = {
  uid: string;
  displayName: string;
  points: number;
  border: Border;
  /** Server-maintained card stats; null for users logged before the
   *  statsByYear backfill ran (renders as a placeholder). */
  stats: YearStats | null;
};

export default function LeaderboardPage() {
  const groups = useStore((s) => s.groups);
  const { user } = useAuth();
  const t = useT();

  const year = new Date().getFullYear();
  const [scope, setScope] = useState<string>("global");

  // The whole board is one query over user docs: the server-maintained
  // yearly score provides membership and order, and the doc carries
  // everything the card shows (name, points, border, achievements, and the
  // per-year stat chips). No session docs are read at all. Guests can't
  // read user docs (rules), so the board is empty until signed in.
  const [roster, setRoster] = useState<UserDoc[]>([]);
  useEffect(() => {
    if (!user) {
      setRoster([]);
      return;
    }
    return watchUsersByYearScore(year, setRoster);
  }, [user, year]);

  const rows = useMemo<Row[]>(() => {
    const memberFilter: Set<string> | null =
      scope === "global"
        ? null
        : new Set(groups.find((g) => g.id === scope)?.members ?? []);
    return roster
      .filter((u) => !memberFilter || memberFilter.has(u.uid))
      .map((u) => {
        // Achievements persisted on the profile drive the border — richer
        // than the old live computation (all-time, not just this year).
        const unlocked = new Set(Object.keys(u.achievements ?? {}));
        return {
          uid: u.uid,
          displayName: u.displayName,
          points: u.scores?.[String(year)] ?? 0,
          border: resolveBorder(u.selectedBorder, unlocked.size, unlocked),
          stats: u.statsByYear?.[String(year)] ?? null,
        };
      });
  }, [roster, groups, scope, year]);

  return (
    <div className="px-4 pt-2">
      <div className="mb-3 flex items-end justify-between">
        <h2 className="font-display text-2xl font-black text-wave-900">
          {t("leaderboard.title")}
        </h2>
        <span className="chip">{t("leaderboard.year_only", { year })}</span>
      </div>

      <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4 py-1">
        <ScopeChip
          label={t("leaderboard.scope.global")}
          active={scope === "global"}
          onClick={() => setScope("global")}
        />
        {groups.map((g) => (
          <ScopeChip
            key={g.id}
            label={`${g.emoji ?? "👥"} ${g.name}`}
            active={scope === g.id}
            onClick={() => setScope(g.id)}
          />
        ))}
      </div>

      <ol className="space-y-2">
        <AnimatePresence mode="popLayout">
          {rows.map((r, i) => (
            <BoardRow key={r.uid} row={r} rank={i} isMe={user?.uid === r.uid} />
          ))}
        </AnimatePresence>
        {rows.length === 0 ? (
          <motion.li
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl bg-white/60 p-6 text-center text-sm text-slate-500"
          >
            {t("leaderboard.empty")}
          </motion.li>
        ) : null}
      </ol>
    </div>
  );
}

function BoardRow({
  row: r,
  rank,
  isMe,
}: {
  row: Row;
  rank: number;
  isMe: boolean;
}) {
  const t = useT();
  const podium = podiumStyle(rank);
  const stats = r.stats;

  // Rows reveal — and their score rolls up from 0 — when they scroll into
  // view rather than all at once on mount, so the odometer effect is
  // actually seen as the user scrolls down the board.
  const ref = useRef<HTMLLIElement | null>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });

  return (
    <motion.li
      ref={ref}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
      exit={{ opacity: 0, y: -8, scale: 0.97 }}
      transition={{ type: "tween", duration: 0.2 }}
      className={cn(
        "glass relative flex items-center gap-3 p-3 transition",
        podium.cardClass,
        isMe && "ring-2 ring-wave-400",
      )}
    >
      <div className="relative flex-none">
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full text-lg font-black",
            podium.medalClass,
            r.border.id !== "none" && `ring-2 ${r.border.ringClass}`,
          )}
        >
          {podium.medal ?? <span>{rank + 1}</span>}
        </div>
        {r.border.id !== "none" ? (
          <span
            className="absolute -right-1 -bottom-1 text-[11px] leading-none drop-shadow-sm"
            title={t(`border.${r.border.id}`)}
          >
            {r.border.emoji}
          </span>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-wave-900">
          {r.displayName}
          {isMe ? (
            <span className="ml-2 rounded-full bg-wave-100 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-wave-700 uppercase">
              {t("common.you")}
            </span>
          ) : null}
        </div>
        {stats ? (
          <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-0.5">
              <MapPin className="h-3 w-3" />{" "}
              {stats.uniquePlaces === 1
                ? t("leaderboard.spot")
                : t("leaderboard.spots", { n: stats.uniquePlaces })}
            </span>
            <span className="inline-flex items-center gap-0.5">
              <Snowflake className="h-3 w-3" />{" "}
              {stats.winters === 1
                ? t("leaderboard.winter")
                : t("leaderboard.winters", { n: stats.winters })}
            </span>
            <span>
              {stats.swims === 1
                ? t("leaderboard.swim")
                : t("leaderboard.swims", { n: stats.swims })}
            </span>
            {stats.countriesAbroad > 0 ? (
              <span className="text-teal-700">
                {t("leaderboard.countries", { n: stats.countriesAbroad + 1 })}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="mt-1 h-3 w-36 rounded bg-slate-200/70" />
        )}
      </div>
      <AnimatedNumber
        value={inView ? r.points : 0}
        className="font-display text-2xl font-black text-wave-700"
      />
    </motion.li>
  );
}

function podiumStyle(rank: number): {
  medal: React.ReactNode | null;
  medalClass: string;
  cardClass: string;
} {
  if (rank === 0)
    return {
      medal: <Crown className="h-5 w-5" />,
      medalClass:
        "bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-md shadow-amber-500/30",
      cardClass:
        "bg-gradient-to-r from-amber-50 via-white to-white ring-1 ring-amber-200",
    };
  if (rank === 1)
    return {
      medal: null,
      medalClass:
        "bg-gradient-to-br from-slate-200 to-slate-400 text-white shadow",
      cardClass: "bg-gradient-to-r from-slate-50 via-white to-white",
    };
  if (rank === 2)
    return {
      medal: null,
      medalClass:
        "bg-gradient-to-br from-orange-300 to-orange-500 text-white shadow",
      cardClass: "bg-gradient-to-r from-orange-50 via-white to-white",
    };
  return {
    medal: null,
    medalClass: "bg-slate-100 text-slate-500",
    cardClass: "",
  };
}

function ScopeChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      data-active={active}
      className="chip whitespace-nowrap data-[active=true]:bg-wave-600 data-[active=true]:text-white data-[active=true]:ring-wave-700"
    >
      {label}
    </button>
  );
}
