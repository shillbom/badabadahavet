import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Crown, Snowflake, MapPin } from "lucide-react";
import { useStore } from "@/store/sessions";
import { useAuth } from "@/auth/AuthContext";
import type { SessionDoc } from "@/lib/types";
import { bonusPointsForUid } from "@/lib/achievements";
import { useT } from "@/lib/i18n";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { cn } from "@/lib/utils";

type Row = {
  uid: string;
  displayName: string;
  points: number;
  bonusPoints: number;
  uniquePlaces: number;
  winters: number;
  sessions: number;
};

export default function LeaderboardPage() {
  const all = useStore((s) => s.allSessions);
  const groups = useStore((s) => s.groups);
  const { user } = useAuth();
  const t = useT();

  const year = new Date().getFullYear();
  const [scope, setScope] = useState<string>("global");

  const rows = useMemo<Row[]>(() => {
    const memberFilter: Set<string> | null =
      scope === "global"
        ? null
        : new Set(groups.find((g) => g.id === scope)?.members ?? []);
    const rows = aggregate(all, memberFilter, all);
    return rows.sort((a, b) => b.points - a.points);
  }, [all, groups, scope]);

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
            label={`👥 ${g.name}`}
            active={scope === g.id}
            onClick={() => setScope(g.id)}
          />
        ))}
      </div>

      <ol className="space-y-2">
        <AnimatePresence mode="popLayout">
          {rows.map((r, i) => {
            const isMe = user?.uid === r.uid;
            const podium = podiumStyle(i);
            return (
              <motion.li
                key={r.uid}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8, scale: 0.97 }}
                transition={{ type: "tween", duration: 0.2 }}
                className={cn(
                  "glass relative flex items-center gap-3 p-3 transition",
                  podium.cardClass,
                  isMe && "ring-2 ring-wave-400",
                )}
              >
                <div
                  className={cn(
                    "flex h-9 w-9 flex-none items-center justify-center rounded-full font-display text-lg font-black",
                    podium.medalClass,
                  )}
                >
                  {podium.medal ?? <span>{i + 1}</span>}
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
                  <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-0.5">
                      <MapPin className="h-3 w-3" />{" "}
                      {r.uniquePlaces === 1
                        ? t("leaderboard.spot")
                        : t("leaderboard.spots", { n: r.uniquePlaces })}
                    </span>
                    <span className="inline-flex items-center gap-0.5">
                      <Snowflake className="h-3 w-3" />{" "}
                      {r.winters === 1
                        ? t("leaderboard.winter")
                        : t("leaderboard.winters", { n: r.winters })}
                    </span>
                    <span>
                      {r.sessions === 1
                        ? t("leaderboard.swim")
                        : t("leaderboard.swims", { n: r.sessions })}
                    </span>
                    {r.bonusPoints > 0 ? (
                      <span className="text-amber-700">
                        {t("leaderboard.bonus_hint", { n: r.bonusPoints })}
                      </span>
                    ) : null}
                  </div>
                </div>
                <AnimatedNumber
                  value={r.points}
                  className="font-display text-2xl font-black text-wave-700"
                />
              </motion.li>
            );
          })}
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

function aggregate(
  sessions: SessionDoc[],
  memberFilter: Set<string> | null,
  allSessions: SessionDoc[],
): Row[] {
  const map = new Map<string, Row>();
  for (const s of sessions) {
    if (memberFilter && !memberFilter.has(s.uid)) continue;
    let row = map.get(s.uid);
    if (!row) {
      row = {
        uid: s.uid,
        displayName: s.displayName,
        points: 0,
        bonusPoints: 0,
        uniquePlaces: 0,
        winters: 0,
        sessions: 0,
      };
      map.set(s.uid, row);
    }
    row.points += s.points;
    row.sessions += 1;
    if (s.isUniqueForUser) row.uniquePlaces += 1;
    if (s.isWinter) row.winters += 1;
    row.displayName = s.displayName;
  }
  for (const row of map.values()) {
    row.bonusPoints = bonusPointsForUid(row.uid, allSessions);
    row.points += row.bonusPoints;
  }
  return [...map.values()];
}
