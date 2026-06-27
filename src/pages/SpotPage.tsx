import { useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Snowflake,
  Sparkles,
  Users,
  Calendar,
  ListChecks,
  LogIn,
  MapPin,
  Share2,
  Thermometer,
  Pencil,
  Trash2,
  ImageOff,
  Delete,
} from "lucide-react";
import {
  addToSwim,
  adminClearSessionPhoto,
  adminDeletePlace,
  adminDeleteSession,
  adminRenamePlace,
  getPlace,
  removeFromSwim,
  watchPlaceSessions,
} from "@/lib/data";
import type { PlaceDoc, SessionDoc } from "@/lib/types";
import {
  formatDate,
  formatDateTime,
  rememberReturnPath,
  shareOrCopy,
} from "@/lib/utils";
import { maybeRefreshPlaceTemp } from "@/lib/refreshTemp";
import SwimMap from "@/components/SwimMap";
import SwimPhoto from "@/components/SwimPhoto";
import ReactionBar from "@/components/ReactionBar";
import { useAuth } from "@/auth/AuthContext";
import { useT } from "@/lib/i18n";
import { toast } from "@/components/ui/Toast";

export default function SpotPage() {
  const { placeId } = useParams<{ placeId: string }>();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const isAdmin = profile?.isAdmin === true;
  const t = useT();
  const [place, setPlace] = useState<PlaceDoc | null>(null);
  const [sessions, setSessions] = useState<SessionDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchParams] = useSearchParams();
  const focusedSessionId = searchParams.get("session");
  // Track which sessions have been highlighted once so we don't replay
  // the effect every time the sessions list re-streams from Firestore.
  const highlightedRef = useRef<Set<string>>(new Set());
  const sessionRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const isGuest = !user;
  const toswimEntry = placeId ? profile?.toswim?.[placeId] : undefined;
  const onToswim = !!toswimEntry;

  useEffect(() => {
    if (!placeId) return;
    let cancelled = false;
    getPlace(placeId).then((p) => {
      if (cancelled) return;
      setPlace(p);
      setLoading(false);
      if (p) maybeRefreshPlaceTemp(p);
    });
    const unsub = watchPlaceSessions(placeId, (s) => setSessions(s));
    return () => {
      cancelled = true;
      unsub();
    };
  }, [placeId]);

  const visibleSessions = sessions;

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

  // When a `?session=<id>` deep link is opened, scroll the matching swim
  // into view once it has streamed in, and flash a highlight ring so the
  // user can spot it in the list.
  useEffect(() => {
    if (!focusedSessionId) return;
    if (highlightedRef.current.has(focusedSessionId)) return;
    const exists = visibleSessions.some((s) => s.id === focusedSessionId);
    if (!exists) return;
    highlightedRef.current.add(focusedSessionId);
    // Wait a tick so the freshly mounted <li ref={...}> is in the map.
    const raf = requestAnimationFrame(() => {
      const el = sessionRefs.current.get(focusedSessionId);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(raf);
  }, [focusedSessionId, visibleSessions]);

  async function onShareSpot() {
    if (!place) return;
    const url = `${window.location.origin}/spot/${place.id}`;
    const result = await shareOrCopy({
      url,
      title: t("spot.share.title", { name: place.name }),
      text: t("spot.share.text", { name: place.name }),
    });
    if (result === "copied") toast.success(t("spot.share.copied"));
    else if (result === "failed") toast.error(t("spot.share.failed"));
  }

  async function onShareSession(s: SessionDoc) {
    if (!place) return;
    const url = `${window.location.origin}/spot/${place.id}?session=${s.id}`;
    const result = await shareOrCopy({
      url,
      title: t("spot.share.session_title", {
        name: s.displayName,
        place: place.name,
      }),
      text: t("spot.share.session_text", {
        name: s.displayName,
        place: place.name,
      }),
    });
    if (result === "copied") toast.success(t("spot.share.copied"));
    else if (result === "failed") toast.error(t("spot.share.failed"));
  }

  async function onToggleToswim() {
    if (!user || !place) return;
    try {
      if (onToswim) {
        await removeFromSwim(user.uid, place.id);
        toast.success(t("spot.toswim.removed"));
      } else {
        await addToSwim(user.uid, place.id);
        toast.success(t("spot.toswim.added"));
      }
    } catch {
      toast.error(t("spot.toswim.error"));
    }
  }

  async function onAdminRename() {
    if (!place) return;
    const next = window.prompt(
      t("admin.rename.prompt", { name: place.name }),
      place.name,
    );
    if (!next || next.trim() === place.name) return;
    try {
      await adminRenamePlace(place.id, next);
      setPlace({ ...place, name: next.trim() });
      toast.success(t("admin.rename.success", { name: next.trim() }));
    } catch {
      toast.error(t("admin.rename.error"));
    }
  }

  async function onAdminDeletePlace() {
    if (!place) return;
    if (
      !window.confirm(
        t("admin.delete_spot.confirm", {
          name: place.name,
          n: sessions.length,
        }),
      )
    )
      return;
    try {
      await adminDeletePlace(place.id);
      toast.success(t("admin.delete_spot.success"));
      navigate("/", { replace: true });
    } catch {
      toast.error(t("admin.delete_spot.error"));
    }
  }

  async function onAdminDeleteSession(id: string) {
    if (!window.confirm(t("admin.delete_session.confirm"))) return;
    try {
      await adminDeleteSession(id);
      toast.success(t("admin.delete_session.success"));
    } catch {
      toast.error(t("admin.delete_session.error"));
    }
  }

  async function onAdminRemovePhoto(id: string) {
    if (!window.confirm(t("admin.remove_photo.confirm"))) return;
    try {
      await adminClearSessionPhoto(id);
      toast.success(t("admin.remove_photo.success"));
    } catch {
      toast.error(t("admin.remove_photo.error"));
    }
  }

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
        {t("spot.not_found")}
      </div>
    );
  }

  return (
    <div className="px-4 pt-2 pb-12">
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => navigate(-1)}
          className="rounded-full bg-white/70 p-2 ring-1 ring-slate-200"
          aria-label={t("common.back")}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-2xl font-black text-wave-900">
            {place.name}
          </h2>
          <div className="flex items-center gap-1 text-[11px] text-slate-500">
            <MapPin className="h-3 w-3" />
            {place.lat.toFixed(4)}, {place.lng.toFixed(4)}
            {sessions.length > 0 ? (
              <>
                {" · "}
                {t("spot.first_dipped", {
                  date: formatDate(
                    sessions.reduce(
                      (min, s) => (s.date < min ? s.date : min),
                      sessions[0].date,
                    ),
                  ),
                })}
              </>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onShareSpot}
          className="rounded-full bg-white/70 p-2 text-wave-700 ring-1 ring-slate-200 hover:bg-white"
          aria-label={t("spot.share")}
          title={t("spot.share")}
        >
          <Share2 className="h-4 w-4" />
        </button>
      </div>

      <div className="h-44 overflow-hidden rounded-2xl border border-white/60 shadow-sm">
        <SwimMap
          places={placesForMap}
          sessionsByPlace={sessionsByPlace}
          center={[place.lat, place.lng]}
          zoom={13}
          linkToSpot={false}
          viewKey={`spot-${place.id}`}
        />
      </div>

      {!isGuest ? (
        <button
          type="button"
          onClick={onToggleToswim}
          className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow ring-1 transition active:scale-95 ${
            onToswim
              ? "bg-rose-50 text-rose-800 ring-rose-200 hover:bg-rose-50"
              : "bg-white/80 text-emerald-700 ring-emerald-200 hover:bg-emerald-100"
          }`}
        >
          {onToswim ? (
            <>
              <Delete className="h-3.5 w-3.5" />
              {t("spot.toswim.remove")}
            </>
          ) : (
            <>
              <ListChecks className="h-3.5 w-3.5" />
              {t("spot.toswim.add")}
            </>
          )}
        </button>
      ) : null}

      {isAdmin ? (
        <div className="mt-3 flex flex-wrap gap-2 rounded-2xl bg-amber-50/80 p-2 ring-1 ring-amber-200">
          <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold tracking-widest text-white uppercase">
            {t("admin.label")}
          </span>
          <button
            onClick={onAdminRename}
            className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
          >
            <Pencil className="h-3 w-3" /> {t("admin.rename")}
          </button>
          <button
            onClick={onAdminDeletePlace}
            className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50"
          >
            <Trash2 className="h-3 w-3" /> {t("admin.delete_spot")}
          </button>
        </div>
      ) : null}

      {photoSessions.length > 0 ? (
        <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
          {photoSessions.map((s) => (
            <div
              key={s.id}
              className="relative h-24 w-24 flex-none overflow-hidden rounded-xl ring-1 ring-white/60"
            >
              <SwimPhoto session={s} className="h-full w-full" />
              <span className="pointer-events-none absolute bottom-1 left-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                {s.displayName}
              </span>
              {isAdmin ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAdminRemovePhoto(s.id);
                  }}
                  className="absolute top-1 right-1 rounded-full bg-rose-600/90 p-1 text-white shadow ring-1 ring-white/30"
                  aria-label={t("admin.remove_photo")}
                  title={t("admin.remove_photo")}
                >
                  <ImageOff className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat label={t("spot.stat.swims")} value={stats.total} />
        <Stat
          label={t("spot.stat.people")}
          value={stats.swimmerCount}
          icon={<Users className="h-3.5 w-3.5" />}
        />
        <Stat
          label={t("spot.stat.winter")}
          value={stats.winterCount}
          icon={<Snowflake className="h-3.5 w-3.5" />}
        />
      </div>

      <WaterTempCard place={place} t={t} />

      {stats.topSwimmer ? (
        <div className="glass mt-3 flex items-center gap-3 p-3">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <div className="text-sm text-wave-900">
            {t("spot.top_swimmer", {
              name: stats.topSwimmer.name,
              n: stats.topSwimmer.count,
            })}
          </div>
        </div>
      ) : null}

      <h3 className="mt-5 mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {t("spot.recent_dips")}
      </h3>
      <ul className="space-y-2">
        {visibleSessions.map((s, i) => (
          <motion.li
            key={s.id}
            ref={(el) => {
              if (el) sessionRefs.current.set(s.id, el);
              else sessionRefs.current.delete(s.id);
            }}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i, 8) * 0.03 }}
            className={`glass flex items-start gap-3 p-3 ${
              focusedSessionId === s.id ? "animate-highlight" : ""
            }`}
          >
            {s.photoUrl ? (
              <SwimPhoto
                session={s}
                className="h-14 w-14 flex-none rounded-lg"
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
                      {t("common.you")}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="font-display text-base font-black text-wave-700">
                    +{s.points}
                  </div>
                  <button
                    onClick={() => onShareSession(s)}
                    className="rounded-full bg-white/80 p-1 text-wave-700 ring-1 ring-slate-200 hover:bg-white"
                    aria-label={t("spot.share_session")}
                    title={t("spot.share_session")}
                  >
                    <Share2 className="h-3 w-3" />
                  </button>
                  {!isGuest && isAdmin ? (
                    <button
                      onClick={() => onAdminDeleteSession(s.id)}
                      className="rounded-full bg-white/80 p-1 text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50"
                      aria-label={t("admin.delete_session")}
                      title={t("admin.delete_session")}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
              </div>
              {s.note ? (
                <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">
                  {s.note}
                </p>
              ) : null}
              <div className="flex items-end justify-between">
                <div className="flex items-center gap-1 text-[11px] text-slate-500">
                  <Calendar className="h-3 w-3" />
                  {formatDateTime(s.date)}
                  {s.isWinter ? <span className="ml-1">❄️</span> : null}
                  {s.isUniqueForUser ? (
                    <span className="ml-0.5">✨</span>
                  ) : null}
                </div>
                <ReactionBar session={s} myUid={user?.uid} />
              </div>
            </div>
          </motion.li>
        ))}
        {visibleSessions.length === 0 ? (
          <li className="rounded-2xl bg-white/60 p-6 text-center text-sm text-slate-500">
            {t("spot.empty.all")}
          </li>
        ) : null}
      </ul>

      <div className="mt-6 text-center">
        {isGuest ? (
          <Link
            to="/login"
            onClick={rememberReturnPath}
            className="inline-flex items-center gap-1.5 rounded-full bg-wave-600 px-4 py-2 text-sm font-medium text-white shadow"
          >
            <LogIn className="h-3.5 w-3.5" />
            {t("spot.guest.cta")}
          </Link>
        ) : (
          <Link
            to={`/log?placeId=${place.id}`}
            className="inline-flex items-center gap-1.5 rounded-full bg-wave-600 px-4 py-2 text-sm font-medium text-white shadow"
          >
            {t("spot.log_here")}
          </Link>
        )}
      </div>
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
  icon?: React.ReactNode;
}) {
  return (
    <div className="glass flex flex-col items-start gap-0.5 px-3 py-2">
      <div className="flex items-center gap-1 text-[10px] font-semibold tracking-wide text-wave-700 uppercase">
        {icon}
        {label}
      </div>
      <div className="font-display text-xl font-black text-wave-900">
        {value}
      </div>
    </div>
  );
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function WaterTempCard({
  place,
  t,
}: {
  place: PlaceDoc;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  if (!place.waterTemp || !place.waterTempAt) return null;
  if (Date.now() - place.waterTempAt > WEEK_MS) return null;

  const ageMs = Date.now() - place.waterTempAt;
  const ageHrs = Math.floor(ageMs / (60 * 60 * 1000));
  const ageMins = Math.floor(ageMs / 60_000);
  const ageLabel =
    ageMins < 60
      ? t("map.popup.age.mins", { n: ageMins })
      : ageHrs < 24
        ? t("map.popup.age.hrs", { n: ageHrs })
        : t("map.popup.age.days", { n: Math.floor(ageHrs / 24) });

  const isWarm = place.waterTemp >= 17;
  const isCool = place.waterTemp < 10;

  return (
    <div
      className={`mt-3 flex items-center gap-2.5 rounded-2xl px-3 py-2.5 ring-1 ${
        isWarm
          ? "bg-amber-50/80 ring-amber-200"
          : isCool
            ? "bg-sky-50/80 ring-sky-200"
            : "bg-teal-50/80 ring-teal-200"
      }`}
    >
      <Thermometer
        className={`h-4 w-4 flex-none ${isWarm ? "text-amber-500" : isCool ? "text-sky-500" : "text-teal-500"}`}
      />
      <span
        className={`font-semibold ${isWarm ? "text-amber-900" : isCool ? "text-sky-900" : "text-teal-900"}`}
      >
        {place.waterTemp.toFixed(1)} °C
      </span>
      <span
        className={`text-xs ${isWarm ? "text-amber-600" : isCool ? "text-sky-600" : "text-teal-600"}`}
      >
        {ageLabel}
      </span>
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
