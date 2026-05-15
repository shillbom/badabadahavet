import { useEffect, useMemo, useRef, useState } from "react";
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
  Pencil,
  Trash2,
  ImageOff,
} from "lucide-react";
import {
  adminClearSessionPhoto,
  adminDeletePlace,
  adminDeleteSession,
  adminRenamePlace,
  getPlace,
  REACTION_EMOJIS,
  toggleReaction,
  watchPlaceSessions,
} from "@/lib/data";
import type { PlaceDoc, SessionDoc } from "@/lib/types";
import { formatDate, formatDateTime } from "@/lib/utils";
import SwimMap from "@/components/SwimMap";
import { useAuth } from "@/auth/AuthContext";
import { useStore } from "@/store/sessions";
import { useT } from "@/lib/i18n";
import { toast } from "@/components/ui/Toast";

export default function SpotPage() {
  const { placeId } = useParams<{ placeId: string }>();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const isAdmin = profile?.isAdmin === true;
  const t = useT();
  const groups = useStore((s) => s.groups);
  const [place, setPlace] = useState<PlaceDoc | null>(null);
  const [sessions, setSessions] = useState<SessionDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"all" | string>("all");
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
        <div className="min-w-0">
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

      {groups.length > 0 ? (
        <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
          <ScopeChip
            label={t("spot.scope.everyone")}
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
            <div
              key={s.id}
              className="relative h-24 w-24 flex-none overflow-hidden rounded-xl ring-1 ring-white/60"
            >
              <button
                onClick={() => setLightboxIdx(idx)}
                className="block h-full w-full"
                aria-label={`${s.displayName}`}
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
        {scope === "all" ? t("spot.recent_dips") : t("spot.group_dips")}
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
                      {t("common.you")}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="font-display text-base font-black text-wave-700">
                    +{s.points}
                  </div>
                  {isAdmin ? (
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
            {scope === "all" ? t("spot.empty.all") : t("spot.empty.group")}
          </li>
        ) : null}
      </ul>

      <div className="mt-6 text-center">
        <Link
          to={`/log?placeId=${place.id}`}
          className="inline-flex items-center gap-1.5 rounded-full bg-wave-600 px-4 py-2 text-sm font-medium text-white shadow"
        >
          {t("spot.log_here")}
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
  const t = useT();
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
            className="absolute top-[max(env(safe-area-inset-top),1rem)] right-4 rounded-full bg-white/10 p-2 text-white"
            aria-label={t("common.close")}
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

function ReactionBar({
  session,
  myUid,
}: {
  session: SessionDoc;
  myUid?: string;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    if (!showPicker) return;
    function onOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node))
        setShowPicker(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [showPicker]);

  const reactions = session.reactions ?? {};
  const activeEmojis = REACTION_EMOJIS.filter(
    (e) => (reactions[e]?.length ?? 0) > 0,
  );

  async function onToggle(emoji: string) {
    if (!myUid || pending) return;
    setPending(emoji);
    try {
      await toggleReaction(session.id, emoji, myUid, reactions[emoji] ?? []);
    } finally {
      setPending(null);
      setShowPicker(false);
    }
  }

  return (
    <div className="relative mt-1.5 flex flex-wrap items-center gap-1">
      {activeEmojis.map((emoji) => {
        const reactors = reactions[emoji] ?? [];
        const mine = !!myUid && reactors.includes(myUid);
        return (
          <motion.button
            key={emoji}
            whileTap={{ scale: 0.85 }}
            disabled={!myUid || pending === emoji}
            onClick={() => onToggle(emoji)}
            aria-label={t("reactions.toggle", { emoji })}
            aria-pressed={mine}
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 transition-colors ${
              mine
                ? "bg-wave-100 text-wave-800 ring-wave-400"
                : "bg-white/70 text-slate-600 ring-slate-200 hover:bg-slate-50"
            } ${pending === emoji ? "opacity-60" : ""}`}
          >
            <span>{emoji}</span>
            <span className="font-medium tabular-nums">{reactors.length}</span>
          </motion.button>
        );
      })}

      {myUid ? (
        <div className="relative" ref={pickerRef}>
          <button
            onClick={() => setShowPicker((v) => !v)}
            aria-label={t("reactions.add")}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-white/70 text-sm ring-1 ring-slate-200 hover:bg-slate-50"
          >
            +
          </button>
          <AnimatePresence>
            {showPicker ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 4 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 bottom-full z-10 mb-1 flex gap-1 rounded-2xl bg-white p-1.5 shadow-lg ring-1 ring-slate-100"
              >
                {REACTION_EMOJIS.map((emoji) => {
                  const mine =
                    !!myUid && (reactions[emoji] ?? []).includes(myUid);
                  return (
                    <button
                      key={emoji}
                      onClick={() => onToggle(emoji)}
                      aria-label={emoji}
                      aria-pressed={mine}
                      className={`flex h-8 w-8 items-center justify-center rounded-xl text-lg transition-colors ${
                        mine ? "bg-wave-100" : "hover:bg-slate-100"
                      }`}
                    >
                      {emoji}
                    </button>
                  );
                })}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      ) : null}
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
