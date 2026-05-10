import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Crown, Snowflake, MapPin } from "lucide-react";
import { useStore } from "@/store/sessions";
import { useAuth } from "@/auth/AuthContext";
import type { GroupDoc, SessionDoc } from "@/lib/types";
import { startOfYear, endOfYear } from "@/lib/scoring";
import { bonusPointsForUid } from "@/lib/achievements";
import { useT } from "@/lib/i18n";

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
  const [yearOnly, setYearOnly] = useState(true);

  const filtered = useMemo(() => {
    if (!yearOnly) return all;
    const start = startOfYear(year);
    const end = endOfYear(year);
    return all.filter((s) => s.date >= start && s.date <= end);
  }, [all, yearOnly, year]);

  const rows = useMemo<Row[]>(() => {
    const memberFilter: Set<string> | null =
      scope === "global"
        ? null
        : new Set(groups.find((g) => g.id === scope)?.members ?? []);
    const rows = aggregate(filtered, memberFilter, all);
    return rows.sort((a, b) => b.points - a.points);
  }, [filtered, groups, scope, all]);

  const activeGroup: GroupDoc | undefined = groups.find((g) => g.id === scope);

  return (
    <div className="px-4 pt-2">
      <div className="mb-3 flex items-end justify-between">
        <h2 className="font-display text-2xl font-black text-wave-900">
          {t("leaderboard.title")}
        </h2>
        <button onClick={() => setYearOnly((v) => !v)} className="chip">
          {yearOnly
            ? t("leaderboard.year_only", { year })
            : t("leaderboard.all_time")}
        </button>
      </div>

      <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
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

      {activeGroup ? (
        <div className="mb-3 flex items-center justify-between rounded-2xl bg-white/70 px-3 py-2 ring-1 ring-white/60">
          <span className="text-xs text-slate-500">
            {t("leaderboard.group_code")}
          </span>
          <code className="font-mono text-sm font-bold tracking-widest text-wave-800">
            {activeGroup.code}
          </code>
        </div>
      ) : null}

      <ol className="space-y-2">
        <AnimatePresence initial={false}>
          {rows.map((r, i) => (
            <motion.li
              key={r.uid}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className={`glass flex items-center gap-3 p-3 ${
                user?.uid === r.uid ? "ring-2 ring-wave-400" : ""
              }`}
            >
              <div className="w-7 text-center font-display text-lg font-black">
                {i === 0 ? (
                  <Crown className="mx-auto h-5 w-5 text-amber-500" />
                ) : (
                  <span className="text-slate-500">{i + 1}</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-wave-900">
                  {r.displayName}
                  {user?.uid === r.uid ? (
                    <span className="ml-2 text-[10px] text-wave-600">
                      {t("common.you")}
                    </span>
                  ) : null}
                </div>
                <div className="flex gap-2 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-0.5">
                    <MapPin className="h-3 w-3" />{" "}
                    {t("leaderboard.spots", { n: r.uniquePlaces })}
                  </span>
                  <span className="inline-flex items-center gap-0.5">
                    <Snowflake className="h-3 w-3" />{" "}
                    {t("leaderboard.winters", { n: r.winters })}
                  </span>
                  <span>{t("leaderboard.swims", { n: r.sessions })}</span>
                  {r.bonusPoints > 0 ? (
                    <span className="text-amber-700">
                      {t("leaderboard.bonus_hint", { n: r.bonusPoints })}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="font-display text-2xl font-black text-wave-700">
                {r.points}
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
        {rows.length === 0 ? (
          <li className="rounded-2xl bg-white/60 p-6 text-center text-sm text-slate-500">
            {t("leaderboard.empty")}
          </li>
        ) : null}
      </ol>
    </div>
  );
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
