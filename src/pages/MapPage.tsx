import { lazy, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { MapPin, Trophy } from "lucide-react";
import { useAllSessionsFeed, useStore } from "@/store/sessions";
import { sumScores } from "@/lib/scoring";
import { useAuth } from "@/auth/AuthContext";
import { useT, getTimeGreeting, useLocale } from "@/lib/i18n";
import StreakCard from "@/components/StreakCard";
import Stat from "@/components/ui/Stat";
const SwimMap = lazy(() => import("@/components/SwimMap"));

export default function MapPage() {
  const { user, profile } = useAuth();
  const t = useT();
  const places = useStore((s) => s.placesWithTemps);
  const myPlaces = useStore((s) => s.myPlaces);
  const sessionsByPlace = useStore((s) => s.sessionsByPlace);
  const myStats = useStore((s) => s.myStats);

  const isGuest = !user;

  // The map's pin popups show the season's swims per place, which come from
  // the community feed — keep it subscribed while this page is on screen.
  // Guests can't read sessions (rules), so don't even try for them.
  useAllSessionsFeed(!isGuest);

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

  // The server-maintained score is authoritative; fall back to the session
  // sum only for users not yet backfilled.
  const totalPoints = profile?.scores
    ? sumScores(profile.scores)
    : myStats.totalPoints;

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
      {isGuest ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass flex items-center justify-between gap-3 p-3 lg:mx-auto lg:w-full lg:max-w-2xl"
        >
          <div className="min-w-0">
            <div className="font-display text-base font-bold text-wave-900">
              {t("map.guest.title")}
            </div>
            <div className="text-[11px] text-slate-500">
              {t("map.guest.subtitle")}
            </div>
          </div>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="lg:mx-auto lg:w-full lg:max-w-2xl"
        >
          <h2 className="font-display text-2xl font-black text-wave-900">
            {greeting}
          </h2>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </motion.div>
      )}

      {!isGuest ? (
        <div className="grid grid-cols-3 gap-2 lg:mx-auto lg:w-full lg:max-w-2xl">
          <Stat
            to="/history"
            size="lg"
            animate
            label={t("map.stat.points")}
            value={totalPoints}
            icon={<Trophy className="h-4 w-4" />}
            sub={t("map.stat.points.sub", { n: myStats.swimsLastWeek })}
          />
          <Stat
            onClick={() =>
              // Switch to "my places" mode (the showAll effect re-fits the
              // bounds). If already there, just re-fit.
              showAll ? setShowAll(false) : setFitToken((n) => n + 1)
            }
            size="lg"
            animate
            label={t("map.stat.spots")}
            value={myStats.uniquePlaces}
            icon={<MapPin className="h-4 w-4" />}
            sub={t("map.stat.spots.sub", { n: myStats.placesLastMonth })}
          />
          <StreakCard streak={myStats.streak} />
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/60 shadow-sm">
        <div className="absolute inset-0">
          {mapReady ? (
            <SwimMap
              places={isGuest || showAll ? places : myPlaces}
              sessionsByPlace={sessionsByPlace}
              userLocation={myLocation}
              fitToken={fitToken}
              fitBoundsToPlaces={!isGuest && !showAll}
              viewKey="main"
              fullscreenControl
              topRightActions={
                isGuest
                  ? undefined
                  : [
                      {
                        label: showAll ? t("map.show.mine") : t("map.show.all"),
                        onClick: () => setShowAll((v) => !v),
                      },
                    ]
              }
            />
          ) : (
            <div className="h-full w-full bg-slate-100" />
          )}
        </div>
      </div>
    </div>
  );
}
