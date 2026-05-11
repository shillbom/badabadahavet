import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Flame, MapPin, Trophy } from "lucide-react";
import { useStore } from "@/store/sessions";
import SwimMap from "@/components/SwimMap";
import { useAuth } from "@/auth/AuthContext";
import type { SessionDoc } from "@/lib/types";
import { computeMyStats } from "@/lib/stats";
import { ACHIEVEMENTS, evaluateAchievements } from "@/lib/achievements";
import { useT } from "@/lib/i18n";
import { AnimatedNumber } from "@/components/AnimatedNumber";

export default function MapPage() {
  const { user, profile } = useAuth();
  const t = useT();
  const places = useStore((s) => s.places);
  const mySessions = useStore((s) => s.mySessions);
  const allSessions = useStore((s) => s.allSessions);

  const [myLocation, setMyLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [fitToken, setFitToken] = useState(0);
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setMyLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
  }, []);

  const stats = useMemo(() => computeMyStats(mySessions), [mySessions]);

  const bonusPts = useMemo(() => {
    const ctx = { uid: user?.uid ?? "", mySessions, allSessions };
    const unlocked = evaluateAchievements(ctx);
    let pts = 0;
    for (const a of ACHIEVEMENTS) if (unlocked.has(a.id)) pts += a.points;
    return pts;
  }, [user, mySessions, allSessions]);

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

  const greetingName = profile?.displayName ?? t("layout.swimmer");
  const subtitle =
    mySessions.length === 0
      ? t("map.empty.subtitle")
      : stats.daysSinceLast === 0
        ? t("map.last.today")
        : stats.daysSinceLast === 1
          ? t("map.last.yesterday")
          : t("map.last.days", { n: stats.daysSinceLast ?? 0 });

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pt-2 pb-2 gap-3">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <h2 className="font-display text-2xl font-black text-wave-900">
          {t("map.greeting", { name: greetingName })}
        </h2>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </motion.div>

      <div className="grid grid-cols-3 gap-2">
        <Stat
          to="/history"
          label={t("map.stat.points")}
          value={totalPoints}
          icon={<Trophy className="h-4 w-4" />}
          sub={bonusPts > 0 ? t("map.bonus.subtitle", { n: bonusPts }) : undefined}
        />
        <Stat
          onClick={() => setFitToken((n) => n + 1)}
          label={t("map.stat.spots")}
          value={stats.uniquePlaces}
          icon={<MapPin className="h-4 w-4" />}
        />
        <Stat
          to="/history?view=streak"
          label={t("map.stat.streak")}
          value={stats.currentDayStreak}
          icon={<Flame className="h-4 w-4" />}
        />
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden rounded-2xl border border-white/60 shadow-sm">
        <div className="absolute inset-0">
          <SwimMap
            places={myPlaces}
            sessionsByPlace={sessionsByPlace}
            userLocation={myLocation}
            fitToken={fitToken}
          />
        </div>
      </div>

      {mySessions.length === 0 ? (
        <p className="text-center text-xs text-slate-500">
          {t("map.empty.helper")}
        </p>
      ) : null}
    </div>
  );
}

function Stat({
  to,
  onClick,
  label,
  value,
  icon,
  sub,
}: {
  to?: string;
  onClick?: () => void;
  label: string;
  value: number;
  icon: React.ReactNode;
  sub?: string;
}) {
  const inner = (
    <>
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-wave-700">
        {icon}
        {label}
      </div>
      <AnimatedNumber
        value={value}
        className="font-display text-2xl font-black text-wave-900"
      />
      {sub ? <div className="text-[10px] text-amber-700">{sub}</div> : null}
    </>
  );
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 280, damping: 24 }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
    >
      {to ? (
        <Link to={to} className="glass flex flex-col items-start gap-1 px-3 py-2.5">
          {inner}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onClick}
          className="glass flex w-full flex-col items-start gap-1 px-3 py-2.5 text-left"
        >
          {inner}
        </button>
      )}
    </motion.div>
  );
}
