import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Flame, MapPin, Trophy } from "lucide-react";
import { useStore } from "@/store/sessions";
import SwimMap from "@/components/SwimMap";
import { useAuth } from "@/auth/AuthContext";
import { useT, getTimeGreeting, useLocale } from "@/lib/i18n";
import { AnimatedNumber } from "@/components/AnimatedNumber";

export default function MapPage() {
  const { profile } = useAuth();
  const t = useT();
  const places = useStore((s) => s.places);
  const myPlaces = useStore((s) => s.myPlaces);
  const sessionsByPlace = useStore((s) => s.sessionsByPlace);
  const myStats = useStore((s) => s.myStats);
  const achievementBonusPoints = useStore((s) => s.achievementBonusPoints);

  // Seed from Firestore so the map opens at the right place without waiting for GPS
  const currentLocation = useStore((s) => s.currentLocation);
  const locationPermission = useStore((s) => s.locationPermission);
  // Fall back to Firestore lastLocation while GPS hasn't resolved yet
  const myLocation = currentLocation ?? profile?.lastLocation ?? null;

  const [fitToken, setFitToken] = useState(0);
  const [showAll, setShowAll] = useState(true);

  // Re-fit whenever the toggle changes so switching to "my places" zooms
  // in to fit them, and switching to "all" re-centres on user position.
  const prevShowAll = useRef(showAll);
  useEffect(() => {
    if (showAll === prevShowAll.current) return;
    prevShowAll.current = showAll;
    setFitToken((n) => n + 1);
  }, [showAll]);

  // Hold the map until we have a real position when permission is already granted
  // (prevents Stockholm → real-location ping-pong on first load)
  const mapReady =
    locationPermission !== "checking" &&
    (locationPermission !== "granted" || myLocation !== null);

  const totalPoints = myStats.totalPoints + achievementBonusPoints;

  // Stable random seed picked once per mount — prevents re-roll on every render.
  const greetingSeed = useRef(Math.floor(Math.random() * 1000));
  // Re-derive greeting when locale or profile name changes.
  const locale = useLocale((s) => s.locale);
  const greetingName = profile?.displayName ?? t("layout.swimmer");
  const greeting = useMemo(
    () => getTimeGreeting(greetingName, greetingSeed.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [greetingName, locale],
  );

  const subtitle =
    myStats.totalSwims === 0
      ? t("map.empty.subtitle")
      : myStats.daysSinceLast === 0
        ? t("map.last.today")
        : myStats.daysSinceLast === 1
          ? t("map.last.yesterday")
          : t("map.last.days", { n: myStats.daysSinceLast ?? 0 });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-2 pb-[calc(max(env(safe-area-inset-bottom),0.5rem)+6rem)]">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <h2 className="font-display text-2xl font-black text-wave-900">
          {greeting}
        </h2>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </motion.div>

      <div className="grid grid-cols-3 gap-2">
        <Stat
          to="/history"
          label={t("map.stat.points")}
          value={totalPoints}
          icon={<Trophy className="h-4 w-4" />}
          sub={
            achievementBonusPoints > 0
              ? t("map.bonus.subtitle", { n: achievementBonusPoints })
              : undefined
          }
        />
        <Stat
          onClick={() => setFitToken((n) => n + 1)}
          label={t("map.stat.spots")}
          value={myStats.uniquePlaces}
          icon={<MapPin className="h-4 w-4" />}
        />
        <Stat
          to="/history?view=streak"
          label={t("map.stat.streak")}
          value={myStats.currentDayStreak}
          icon={<Flame className="h-4 w-4" />}
          sub={
            myStats.currentDayStreak > 0 && myStats.daysSinceLast === 1
              ? t("map.streak.at_risk")
              : undefined
          }
        />
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/60 shadow-sm">
        <div className="absolute inset-0">
          {mapReady ? (
            <SwimMap
              places={showAll ? places : myPlaces}
              sessionsByPlace={sessionsByPlace}
              userLocation={myLocation}
              fitToken={fitToken}
              fitBoundsToPlaces={!showAll}
              viewKey="main"
            />
          ) : (
            <div className="h-full w-full bg-slate-100" />
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="absolute top-3 right-3 z-[600] flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-wave-700 shadow-md ring-1 ring-slate-200 transition hover:bg-white active:scale-95"
        >
          {showAll ? t("map.show.mine") : t("map.show.all")}
        </button>
      </div>

      {myStats.totalSwims === 0 ? (
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
      <div className="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-wave-700 uppercase">
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
        <Link
          to={to}
          className="glass flex flex-col items-start gap-1 px-3 py-2.5"
        >
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
