import {
  lazy,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
  useState,
} from "react";
import { m } from "framer-motion";
import { MapPin, Trophy } from "lucide-react";
import { useAllSessionsFeed, useStore } from "@/store/sessions";
import { sumScores } from "@/lib/scoring";
import { useAuth } from "@/auth/AuthContext";
import {
  useT,
  getRecentSwimMessage,
  getTimeGreeting,
  useLocale,
} from "@/lib/i18n";
import StreakCard from "@/components/StreakCard";
import Stat from "@/components/ui/Stat";
import { usePosition } from "@/hooks/position";
import { useDeviceFocus } from "@/hooks/focus";
import { haversineMeters } from "@/lib/utils";
const SwimMap = lazy(() => import("@/components/SwimMap"));

export default function MapPage() {
  const { user, profile } = useAuth();
  const t = useT();
  const places = useStore((s) => s.placesWithTemps);
  const myPlaces = useStore((s) => s.myPlaces);
  const mySessions = useStore((s) => s.mySessions);
  const sessionsByPlace = useStore((s) => s.sessionsByPlace);
  const myStats = useStore((s) => s.myStats);

  const isGuest = !user;

  // The map's pin popups show the season's swims per place, which come from
  // the community feed — keep it subscribed while this page is on screen.
  // Guests can't read sessions (rules), so don't even try for them.
  useAllSessionsFeed(!isGuest);

  // Seed from Firestore so the map opens at the right place without waiting for GPS
  const locationPermission = useStore((s) => s.locationPermission);
  // Fall back to Firestore lastLocation while GPS hasn't resolved yet
  const myLocation = usePosition();
  const previousLocation = useRef(myLocation);

  // ⋯ menu "my places" filter, three modes: "off" (default) = every spot,
  // coloured by the community's last swim; "on" = every spot, but a pin only
  // glows blue when *I've* swum there (recency from my own swims); "only" =
  // just the spots I've swum at.
  const [{ fitToken, mineMode }, dispatchMapView] = useReducer(
    (
      state: { fitToken: number; mineMode: "off" | "on" | "only" },
      action:
        { type: "refit" } | { type: "mineMode"; value: "off" | "on" | "only" },
    ) =>
      action.type === "refit"
        ? { ...state, fitToken: state.fitToken + 1 }
        : { mineMode: action.value, fitToken: state.fitToken + 1 },
    { fitToken: 0, mineMode: "off" },
  );
  // ⋯ menu naturist filter: "only" = just naturist spots, "on" (default) =
  // everything, "off" = hide naturist spots.
  const [nudeMode, setNudeMode] = useState<"only" | "on" | "off">("on");

  const shownPlaces = (() => {
    let base = isGuest || mineMode !== "only" ? places : myPlaces;
    // "on": keep every spot visible but recolour from my own swims, so a pin
    // is only blue where I've been (grey everywhere else).
    if (!isGuest && mineMode === "on") {
      const myLastSwim = new Map<string, number>();
      for (const s of mySessions) {
        const prev = myLastSwim.get(s.placeId);
        if (prev === undefined || s.date > prev)
          myLastSwim.set(s.placeId, s.date);
      }
      base = base.map((p) => {
        const mine = myLastSwim.get(p.id);
        return {
          ...p,
          lastSwimAt: mine,
          lastSwimBorder: mine !== undefined ? p.lastSwimBorder : undefined,
        };
      });
    }
    if (nudeMode === "only") return base.filter((p) => p.nude === true);
    if (nudeMode === "off") return base.filter((p) => p.nude !== true);
    return base;
  })();

  const isFocused = useDeviceFocus();
  useEffect(() => {
    if (isFocused) {
      dispatchMapView({ type: "refit" });
    }
  }, [isFocused]);

  const updateLocationAfterMove = useEffectEvent(
    (pos: { lat: number; lng: number }) => {
      if (
        previousLocation.current == null ||
        (previousLocation.current &&
          haversineMeters(previousLocation.current, pos) > 500)
      ) {
        dispatchMapView({ type: "refit" });
      }
      previousLocation.current = pos;
    },
  );
  useEffect(() => {
    if (myLocation) {
      updateLocationAfterMove(myLocation);
    }
  }, [myLocation]);

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
  const [greetingSeed] = useState(() => Math.floor(Math.random() * 1000));
  // Subscribe to locale so the greeting re-derives when it (or the profile
  // name) changes — getTimeGreeting reads the active language internally.
  useLocale((s) => s.locale);
  const greetingName = profile?.displayName ?? t("layout.swimmer");
  const greeting = getTimeGreeting(greetingName, greetingSeed);

  const subtitle =
    myStats.totalSwims === 0
      ? t("map.empty.subtitle")
      : myStats.daysSinceLast === 0
        ? getRecentSwimMessage("today", greetingSeed)
        : myStats.daysSinceLast === 1
          ? getRecentSwimMessage("yesterday", greetingSeed)
          : t("map.last.days", { n: myStats.daysSinceLast ?? 0 });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-2 pb-[calc(max(env(safe-area-inset-bottom),0.5rem)+6rem)]">
      {isGuest ? (
        <m.div
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
        </m.div>
      ) : (
        <m.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="lg:mx-auto lg:w-full lg:max-w-2xl"
        >
          <h2 className="font-display text-2xl font-black text-wave-900">
            {greeting}
          </h2>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </m.div>
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
              mineMode !== "only"
                ? dispatchMapView({ type: "mineMode", value: "only" })
                : dispatchMapView({ type: "refit" })
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
              places={shownPlaces}
              sessionsByPlace={sessionsByPlace}
              userLocation={myLocation}
              fitToken={fitToken}
              fitBoundsToPlaces={!isGuest && mineMode === "only"}
              viewKey="main"
              fullscreenControl
              menuToggles={[
                ...(isGuest
                  ? []
                  : [
                      {
                        label: t("map.filter.mine"),
                        value: mineMode,
                        options: [
                          { value: "only", label: t("map.filter.mode.only") },
                          { value: "on", label: t("map.filter.mode.on") },
                          { value: "off", label: t("map.filter.mode.off") },
                        ],
                        onSelect: (v: string) =>
                          dispatchMapView({
                            type: "mineMode",
                            value: v as "off" | "on" | "only",
                          }),
                      },
                    ]),
                {
                  label: t("map.filter.nude"),
                  value: nudeMode,
                  options: [
                    { value: "only", label: t("map.filter.mode.only") },
                    { value: "on", label: t("map.filter.mode.on") },
                    { value: "off", label: t("map.filter.mode.off") },
                  ],
                  onSelect: (v: string) =>
                    setNudeMode(v as "only" | "on" | "off"),
                },
              ]}
            />
          ) : (
            <div className="h-full w-full bg-slate-100" />
          )}
        </div>
      </div>
    </div>
  );
}
