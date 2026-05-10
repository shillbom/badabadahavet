import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Snowflake,
  Sparkles,
  Users,
  Calendar,
  MapPin,
  X,
} from "lucide-react";
import { getPlace, watchPlaceSessions } from "@/lib/data";
import type { PlaceDoc, SessionDoc } from "@/lib/types";
import { formatDate, formatDateTime } from "@/lib/utils";
import SwimMap from "@/components/SwimMap";
import { useAuth } from "@/auth/AuthContext";
import { useStore } from "@/store/sessions";

export default function SpotPage() {
  const { placeId } = useParams<{ placeId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const groups = useStore((s) => s.groups);
  const [place, setPlace] = useState<PlaceDoc | null>(null);
  const [sessions, setSessions] = useState<SessionDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"all" | string>("all"); // "all" or group id
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  useEffect(() => {
    if (!placeId) return;
    let cancelled = false;
    getPlace(placeId).then((p) => {
      if (cancelled) return;
      setPlace(p);
      setLoading(false);
    });
    const unsub = watchPlaceSessions(placeId, (s) => setSessions(s));
    return () => {
      cancelled = true;
      unsub();
    };
  }, [placeId]);

  const visibleSessions = useMemo(() => {
    if (scope === "all") return sessions;
    const g = groups.find((g) => g.id === scope);
    if (!g) return sessions;
    const memberSet = new Set(g.members);
    return sessions.filter((s) => memberSet.has(s.uid));
  }, [sessions, scope, groups]);

  const stats = useMemo(
    () => buildStats(visibleSessions, user?.uid),
    [visibleSessions, user],
  );
  const placesForMap = useMemo(() => (place ? [place] : []), [place]);
  const sessionsByPlace = useMemo(() => {
    const m = new Map<string, SessionDoc[]>();
    if (place) m.set(place.id, visibleSessions);
    return m;
  }, [visibleSessions, place]);

  const photoSessions = useMemo(
    () => visibleSessions.filter((s) => s.photoUrl),
    [visibleSessions],
  );

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-wave-600 border-r-transparent" />
      </div>
    );
  }
  if (!place) {
    return (
      <div className="px-4 pt-6 text-center text-sm text-slate-500">
        That spot doesn't exist (any more).
      </div>
    );
  }

  return (
    <div className="px-4 pb-12 pt-2">
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => navigate(-1)}
          className="rounded-full bg-white/70 p-2 ring-1 ring-slate-200"
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <h2 className="truncate font-display text-2xl font-black text-wave-900">
            {place.name}
          </h2>
          <div className="flex items-center gap-1 text-[11px] text-slate-500">
            <MapPin className="h-3 w-3" />
            {place.lat.toFixed(4)}, {place.lng.toFixed(4)} · first dipped{" "}
            {formatDate(place.firstSwumAt)}
          </div>
        </div>
      </div>

      <div className="h-44 overflow-hidden rounded-2xl border border-white/60 shadow-sm">
        <SwimMap
          places={placesForMap}
          sessionsByPlace={sessionsByPlace}
          center={[place.lat, place.lng]}
          zoom={13}
          linkToSpot={false}
        />
      </div>

      {groups.length > 0 ? (
        <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
          <ScopeChip
            label="🌍 Everyone"
            active={scope === "all"}
            onClick={() => setScope("all")}
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
      ) : null}

      {photoSessions.length > 0 ? (
        <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
          {photoSessions.map((s, idx) => (
            <button
              key={s.id}
              onClick={() => setLightboxIdx(idx)}
              className="relative h-24 w-24 flex-none overflow-hidden rounded-xl ring-1 ring-white/60"
            >
              <img
                src={s.photoUrl!}
                alt=""
                className="h-full w-full object-cover transition-transform hover:scale-110"
              />
              <span className="absolute bottom-1 left-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                {s.displayName}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="Swims" value={stats.total} />
        <Stat
          label="People"
          value={stats.swimmerCount}
          icon={<Users className="h-3.5 w-3.5" />}
        />
        <Stat
          label="Winter"
          value={stats.winterCount}
          icon={<Snowflake className="h-3.5 w-3.5" />}
        />
      </div>

      {stats.topSwimmer ? (
        <div className="mt-3 glass flex items-center gap-3 p-3">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <div className="text-sm">
            <span className="font-semibold text-wave-900">
              {stats.topSwimmer.name}
            </span>
            <span className="text-slate-500">
              {" "}
              has the most dips here ({stats.topSwimmer.count})
            </span>
          </div>
        </div>
      ) : null}

      <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {scope === "all" ? "Recent dips" : "Group dips"}
      </h3>
      <ul className="space-y-2">
        {visibleSessions.map((s, i) => (
          <motion.li
            key={s.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i, 8) * 0.03 }}
            className="glass flex items-start gap-3 p-3"
          >
            {s.photoUrl ? (
              <img
                src={s.photoUrl}
                alt=""
                className="h-14 w-14 flex-none rounded-lg object-cover"
              />
            ) : (
              <div className="flex h-14 w-14 flex-none items-center justify-center rounded-lg bg-wave-100 text-2xl">
                🌊
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="truncate font-semibold text-wave-900">
                  {s.displayName}
                  {s.uid === user?.uid ? (
                    <span className="ml-1.5 text-[10px] text-wave-600">
                      you
                    </span>
                  ) : null}
                </div>
                <div className="font-display text-base font-black text-wave-700">
                  +{s.points}
                </div>
              </div>
              <div className="flex items-center gap-1 text-[11px] text-slate-500">
                <Calendar className="h-3 w-3" />
                {formatDateTime(s.date)}
                {s.isWinter ? <span className="ml-1">❄️</span> : null}
                {s.isUniqueForUser ? <span className="ml-0.5">✨</span> : null}
              </div>
              {s.note ? (
                <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">
                  {s.note}
                </p>
              ) : null}
            </div>
          </motion.li>
        ))}
        {visibleSessions.length === 0 ? (
          <li className="rounded-2xl bg-white/60 p-6 text-center text-sm text-slate-500">
            {scope === "all"
              ? "No swims here yet."
              : "Nobody in this group has swum here yet."}
          </li>
        ) : null}
      </ul>

      <div className="mt-6 text-center">
        <Link
          to="/log"
          className="inline-flex items-center gap-1.5 rounded-full bg-wave-600 px-4 py-2 text-sm font-medium text-white shadow"
        >
          Log a swim here
        </Link>
      </div>

      <Lightbox
        sessions={photoSessions}
        index={lightboxIdx}
        onClose={() => setLightboxIdx(null)}
      />
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

function Lightbox({
  sessions,
  index,
  onClose,
}: {
  sessions: SessionDoc[];
  index: number | null;
  onClose: () => void;
}) {
  const s = index != null ? sessions[index] : null;
  return (
    <AnimatePresence>
      {s ? (
        <motion.div
          key={s.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/85 p-4"
        >
          <button
            onClick={onClose}
            className="absolute right-4 top-[max(env(safe-area-inset-top),1rem)] rounded-full bg-white/10 p-2 text-white"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
          <motion.div
            initial={{ scale: 0.92, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: 8 }}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85dvh] max-w-full"
          >
            <img
              src={s.photoUrl!}
              alt=""
              className="max-h-[80dvh] max-w-full rounded-xl"
            />
            <div className="mt-2 text-center text-xs text-white/80">
              {s.displayName} · {formatDate(s.date)}
              {s.note ? ` · ${s.note}` : ""}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
}) {
  return (
    <div className="glass flex flex-col items-start gap-0.5 px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-wave-700">
        {icon}
        {label}
      </div>
      <div className="font-display text-xl font-black text-wave-900">
        {value}
      </div>
    </div>
  );
}

function buildStats(sessions: SessionDoc[], myUid?: string) {
  const counts = new Map<string, { name: string; count: number }>();
  let winterCount = 0;
  let mine = 0;
  for (const s of sessions) {
    if (s.isWinter) winterCount++;
    if (s.uid === myUid) mine++;
    const cur = counts.get(s.uid) ?? { name: s.displayName, count: 0 };
    cur.count += 1;
    cur.name = s.displayName;
    counts.set(s.uid, cur);
  }
  let topSwimmer: { name: string; count: number } | null = null;
  for (const v of counts.values()) {
    if (!topSwimmer || v.count > topSwimmer.count) topSwimmer = v;
  }
  return {
    total: sessions.length,
    swimmerCount: counts.size,
    winterCount,
    mine,
    topSwimmer,
  };
}
