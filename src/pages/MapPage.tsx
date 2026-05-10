import { useMemo } from "react";
import { motion } from "framer-motion";
import { Snowflake, MapPin, Trophy } from "lucide-react";
import { useStore } from "@/store/sessions";
import SwimMap from "@/components/SwimMap";
import { useAuth } from "@/auth/AuthContext";
import type { SessionDoc } from "@/lib/types";

export default function MapPage() {
  const { profile } = useAuth();
  const places = useStore((s) => s.places);
  const mySessions = useStore((s) => s.mySessions);

  const myStats = useMemo(() => stats(mySessions), [mySessions]);

  const sessionsByPlace = useMemo(() => {
    const m = new Map<string, SessionDoc[]>();
    for (const s of mySessions) {
      const arr = m.get(s.placeId) ?? [];
      arr.push(s);
      m.set(s.placeId, arr);
    }
    return m;
  }, [mySessions]);

  // Only show places the user has actually swum at on their personal map.
  const myPlaces = useMemo(
    () => places.filter((p) => sessionsByPlace.has(p.id)),
    [places, sessionsByPlace],
  );

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
            : "Your map of dips this year."}
        </p>
      </motion.div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Points" value={myStats.points} icon={<Trophy className="h-4 w-4" />} />
        <Stat
          label="Spots"
          value={myStats.uniquePlaces}
          icon={<MapPin className="h-4 w-4" />}
        />
        <Stat
          label="Winter"
          value={myStats.winterCount}
          icon={<Snowflake className="h-4 w-4" />}
        />
      </div>

      <div className="mt-4 h-[58vh] overflow-hidden rounded-2xl border border-white/60 shadow-sm">
        <SwimMap places={myPlaces} sessionsByPlace={sessionsByPlace} />
      </div>

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
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
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
    </motion.div>
  );
}

function stats(sessions: SessionDoc[]) {
  let points = 0;
  let winterCount = 0;
  const placeIds = new Set<string>();
  for (const s of sessions) {
    points += s.points;
    if (s.isWinter) winterCount++;
    placeIds.add(s.placeId);
  }
  return { points, winterCount, uniquePlaces: placeIds.size };
}
