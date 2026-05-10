import { useMemo } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Snowflake,
  MapPin,
  Trophy,
  Flame,
  CalendarHeart,
  Compass,
  Star,
  Clock,
  Award,
  Sparkles,
} from "lucide-react";
import { useStore } from "@/store/sessions";
import SwimMap from "@/components/SwimMap";
import { useAuth } from "@/auth/AuthContext";
import type { SessionDoc } from "@/lib/types";
import { MONTHS, computeMyStats } from "@/lib/stats";
import { formatDate } from "@/lib/utils";
import {
  ACHIEVEMENTS,
  ACHIEVEMENTS_BY_ID,
  evaluateAchievements,
} from "@/lib/achievements";

export default function MapPage() {
  const { user, profile } = useAuth();
  const places = useStore((s) => s.places);
  const mySessions = useStore((s) => s.mySessions);
  const allSessions = useStore((s) => s.allSessions);

  const stats = useMemo(() => computeMyStats(mySessions), [mySessions]);

  const achievementCtx = useMemo(
    () => ({ uid: user?.uid ?? "", mySessions, allSessions }),
    [user, mySessions, allSessions],
  );
  const unlocked = useMemo(
    () => evaluateAchievements(achievementCtx),
    [achievementCtx],
  );
  const bonusPts = useMemo(() => {
    let pts = 0;
    for (const a of ACHIEVEMENTS) if (unlocked.has(a.id)) pts += a.points;
    return pts;
  }, [unlocked]);

  const sessionsByPlace = useMemo(() => {
    const m = new Map<string, SessionDoc[]>();
    for (const s of mySessions) {
      const arr = m.get(s.placeId) ?? [];
      arr.push(s);
      m.set(s.placeId, arr);
    }
    return m;
  }, [mySessions]);

  const myPlaces = useMemo(
    () => places.filter((p) => sessionsByPlace.has(p.id)),
    [places, sessionsByPlace],
  );

  const totalPoints = stats.totalPoints + bonusPts;

  return (
    <div className="px-4 pt-2">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-3"
      >
        <h2 className="font-display text-2xl font-black text-wave-900">
          Hej {profile?.displayName ?? "swimmer"} 👋
        </h2>
        <p className="text-sm text-slate-500">
          {mySessions.length === 0
            ? "Tap + to log your first dip."
            : stats.daysSinceLast === 0
              ? "You swam today — nice."
              : stats.daysSinceLast === 1
                ? "You swam yesterday."
                : `It's been ${stats.daysSinceLast} days since your last dip.`}
        </p>
      </motion.div>

      <div className="grid grid-cols-3 gap-2">
        <Stat
          label="Points"
          value={totalPoints}
          icon={<Trophy className="h-4 w-4" />}
          sub={bonusPts > 0 ? `+${bonusPts} from bonuses` : undefined}
        />
        <Stat
          label="Spots"
          value={stats.uniquePlaces}
          icon={<MapPin className="h-4 w-4" />}
        />
        <Stat
          label="Winter"
          value={stats.winterSwims}
          icon={<Snowflake className="h-4 w-4" />}
        />
      </div>

      {mySessions.length > 0 ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link
            to="/recap"
            className="glass flex items-center gap-2 bg-gradient-to-br from-amber-50 via-white to-wave-50 p-3"
          >
            <Sparkles className="h-5 w-5 text-amber-500" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Year recap
              </div>
              <div className="font-display text-sm font-bold text-wave-900">
                Rewind {new Date().getFullYear()} →
              </div>
            </div>
          </Link>
          <Link
            to="/achievements"
            className="glass flex items-center gap-2 p-3"
          >
            <Award className="h-5 w-5 text-amber-500" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Achievements
              </div>
              <div className="font-display text-sm font-bold text-wave-900">
                {unlocked.size}/{ACHIEVEMENTS.length} earned
              </div>
            </div>
          </Link>
        </div>
      ) : null}

      {unlocked.size > 0 ? (
        <div className="no-scrollbar mt-3 -mx-4 flex gap-1.5 overflow-x-auto px-4">
          {[...unlocked]
            .map((id) => ACHIEVEMENTS_BY_ID[id])
            .filter(Boolean)
            .slice(0, 12)
            .map((a) => (
              <span
                key={a.id}
                className="flex-none rounded-full bg-white/80 px-2.5 py-1 text-base ring-1 ring-amber-200"
                title={`${a.name} · +${a.points}`}
              >
                {a.emoji}
              </span>
            ))}
        </div>
      ) : null}

      <div className="mt-4 h-[48vh] overflow-hidden rounded-2xl border border-white/60 shadow-sm">
        <SwimMap places={myPlaces} sessionsByPlace={sessionsByPlace} />
      </div>

      {mySessions.length > 0 ? <Vibes stats={stats} /> : null}

      {mySessions.length === 0 ? (
        <p className="mt-4 text-center text-xs text-slate-500">
          No swims yet — when you log one, a pin shows up here. ✨
        </p>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  sub,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  sub?: string;
}) {
  return (
    <motion.div
      whileHover={{ y: -2 }}
      className="glass flex flex-col items-start gap-1 px-3 py-2.5"
    >
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-wave-700">
        {icon}
        {label}
      </div>
      <div className="font-display text-2xl font-black text-wave-900">
        {value}
      </div>
      {sub ? (
        <div className="text-[10px] text-amber-700">{sub}</div>
      ) : null}
    </motion.div>
  );
}

function Vibes({
  stats,
}: {
  stats: ReturnType<typeof computeMyStats>;
}) {
  return (
    <div className="mt-4 space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        Vibes
      </h3>

      <div className="grid grid-cols-2 gap-2">
        <MiniStat
          icon={<Flame className="h-4 w-4 text-amber-500" />}
          label="Streak"
          value={
            stats.currentWeekStreak === 0
              ? "—"
              : `${stats.currentWeekStreak} wk${stats.currentWeekStreak === 1 ? "" : "s"}`
          }
          sub={
            stats.longestWeekStreak > stats.currentWeekStreak
              ? `Best: ${stats.longestWeekStreak} wks`
              : "On fire"
          }
        />
        <MiniStat
          icon={<Clock className="h-4 w-4 text-wave-600" />}
          label="Last swim"
          value={
            stats.daysSinceLast == null
              ? "—"
              : stats.daysSinceLast === 0
                ? "Today"
                : `${stats.daysSinceLast}d ago`
          }
          sub={`${stats.totalSwims} swims total`}
        />
      </div>

      {stats.favouriteSpot ? (
        <Link
          to={`/spot/${stats.favouriteSpot.placeId}`}
          className="glass flex items-center gap-3 p-3"
        >
          <Star className="h-5 w-5 text-amber-500" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Most-loved spot
            </div>
            <div className="truncate font-display text-base font-bold text-wave-900">
              {stats.favouriteSpot.name}
            </div>
          </div>
          <div className="font-display text-xl font-black text-wave-700">
            {stats.favouriteSpot.count}
          </div>
        </Link>
      ) : null}

      {stats.range ? (
        <div className="glass flex items-center gap-3 p-3">
          <Compass className="h-5 w-5 text-wave-600" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Your watery range
            </div>
            <div className="text-sm text-wave-900">
              spans <strong>{stats.range.km.toFixed(1)} km</strong>
            </div>
          </div>
        </div>
      ) : null}

      {stats.bestMonth ? (
        <div className="glass flex items-center gap-3 p-3">
          <CalendarHeart className="h-5 w-5 text-rose-500" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Best month so far
            </div>
            <div className="text-sm text-wave-900">
              <strong>{MONTHS[stats.bestMonth.month]}</strong> ·{" "}
              {stats.bestMonth.points} pts
            </div>
          </div>
        </div>
      ) : null}

      {stats.onThisDay ? (
        <Link
          to={`/spot/${stats.onThisDay.placeId}`}
          className="glass flex items-start gap-3 bg-gradient-to-br from-wave-50 to-white p-3"
        >
          <span className="text-2xl">🗓️</span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-wave-700">
              On this day
            </div>
            <div className="text-sm text-wave-900">
              You swam at{" "}
              <strong className="truncate">{stats.onThisDay.placeName}</strong>{" "}
              on {formatDate(stats.onThisDay.date)}
              {stats.onThisDay.isWinter ? " ❄️" : ""}
            </div>
          </div>
        </Link>
      ) : null}
    </div>
  );
}

function MiniStat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="glass flex flex-col gap-0.5 px-3 py-2.5">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {icon}
        {label}
      </div>
      <div className="font-display text-lg font-black text-wave-900">
        {value}
      </div>
      {sub ? <div className="text-[10px] text-slate-500">{sub}</div> : null}
    </div>
  );
}
