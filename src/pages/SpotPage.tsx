import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import {
  ArrowLeft,
  Info,
  Snowflake,
  Sparkles,
  Users,
  ListChecks,
  LogIn,
  MapPin,
  Plus,
  Share2,
  Thermometer,
  Droplets,
  Pencil,
  Trash2,
  ImageOff,
  Delete,
  X,
} from "lucide-react";
import {
  addToSwim,
  adminClearSessionPhoto,
  adminDeletePlace,
  adminDeleteSession,
  adminRenamePlace,
  getPlace,
  MIN_INFO_POINTS,
  removeFromSwim,
  setPlaceInfo,
  totalPoints,
  watchPlaceSessions,
  watchPlaceTemp,
  watchPlaceTempHistory,
} from "@/lib/data";
import { assertTextAllowed, ModerationError } from "@/lib/moderation";
import type {
  PlaceDoc,
  PlaceTempDoc,
  PlaceTempHistoryDoc,
  PlaceWithTemp,
  SessionDoc,
  TempReading,
  TempSource,
  WaterSample,
} from "@/lib/types";
import { formatDate, rememberReturnPath, shareOrCopy } from "@/lib/utils";
import { freshestReading } from "@/lib/temps";
import {
  algaeSeverity,
  isSampleFresh,
  sampleSeverity,
  type QualitySeverity,
} from "@/lib/waterQuality";
import { maybeRefreshPlaceTemp } from "@/lib/refreshTemp";
import { useStore } from "@/store/sessions";
import SwimMap from "@/components/SwimMap";
import SwimPhoto from "@/components/SwimPhoto";
import ReactionBar from "@/components/ReactionBar";
import SwimListItem from "@/components/SwimListItem";
import { useAuth } from "@/auth/AuthContext";
import { useIsAdmin } from "@/lib/adminMode";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui/Button";
import { buttonClasses } from "@/components/ui/buttonStyles";
import { Textarea } from "@/components/ui/Input";
import Stat from "@/components/ui/Stat";
import { toast } from "@/components/ui/toastStore";

/**
 * The spot detail UI (map, stats, photos, recent dips). Extracted from the
 * routed page so it can also be rendered inside a {@link BottomSheet} (e.g.
 * tapping a place in the recap) without a full navigation.
 *
 * `variant` swaps the top-left affordance: "page" shows a back button that
 * pops the history stack; "sheet" shows a close button that calls `onClose`.
 */
export function SpotView({
  placeId,
  variant = "page",
  onClose,
}: {
  placeId: string;
  variant?: "page" | "sheet";
  onClose?: () => void;
}) {
  // Changing spots is a full data-context change. A keyed remount resets the
  // subscriptions and live-reading state before the new spot can render,
  // without an extra effect-driven reset.
  return (
    <SpotViewContent
      key={placeId}
      placeId={placeId}
      variant={variant}
      onClose={onClose}
    />
  );
}

function SpotViewContent({
  placeId,
  variant = "page",
  onClose,
}: {
  placeId: string;
  variant?: "page" | "sheet";
  onClose?: () => void;
}) {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const isAdmin = useIsAdmin();
  const t = useT();
  const { place, loading, setPlace, sessions, reading, waterSample } =
    useSpotData(placeId);
  const [showTempHistory, setShowTempHistory] = useState(false);
  const [searchParams] = useSearchParams();
  const focusedSessionId = searchParams.get("session");
  // Track which sessions have been highlighted once so we don't replay
  // the effect every time the sessions list re-streams from Firestore.
  const highlightedRef = useRef<Set<string>>(new Set());
  const sessionRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  const isGuest = !user;
  const toswimEntry = placeId ? profile?.toswim?.[placeId] : undefined;
  const onToswim = !!toswimEntry;

  const visibleSessions = sessions;

  const stats = buildStats(visibleSessions, user?.uid);

  // When a `?session=<id>` deep link is opened (e.g. a shared swim), scroll
  // the matching swim into view once it has streamed in, and flash a
  // highlight ring so the user can spot it in the list.
  //
  // A single scroll isn't enough: the mini-map (a lazily-loaded Leaflet chunk)
  // and the photo thumbnails above the list finish laying out *after* this
  // first fires and push the row down — so a one-shot smooth scroll lands on
  // stale coordinates (or gets interrupted mid-animation) and the swim ends
  // up off-screen. Re-center a few times as the layout settles, using instant
  // scrolls so no long animation is in flight when a height changes, then a
  // final smooth nudge to tidy up. Guarded to run once per session id.
  useEffect(() => {
    if (!focusedSessionId) return;
    if (highlightedRef.current.has(focusedSessionId)) return;
    const exists = visibleSessions.some((s) => s.id === focusedSessionId);
    if (!exists) return;
    highlightedRef.current.add(focusedSessionId);
    const recenter = (smooth: boolean) => {
      const el = sessionRefs.current.get(focusedSessionId);
      el?.scrollIntoView({
        behavior: smooth ? "smooth" : "auto",
        block: "center",
      });
    };
    const timers = [0, 200, 500, 1000].map((delay) =>
      window.setTimeout(() => recenter(delay === 1000), delay),
    );
    return () => timers.forEach(clearTimeout);
  }, [focusedSessionId, visibleSessions]);

  async function onShareSpot() {
    if (!place) return;
    // `/s/...` is the share entrypoint that serves per-place OG tags to link
    // scrapers and 302s real browsers into `/spot/...` (see functions/index.js
    // spotPreview + the SPA fallback route in App.tsx).
    const url = `${window.location.origin}/s/${place.id}`;
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
    const url = `${window.location.origin}/s/${place.id}?session=${s.id}`;
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
      if (variant === "sheet") onClose?.();
      else navigate("/", { replace: true });
    } catch {
      toast.error(t("admin.delete_spot.error"));
    }
  }

  function onEditSession(id: string) {
    // Close the sheet first when embedded — the edit page is a full route
    // and the sheet would otherwise stay open on top of it.
    if (variant === "sheet") onClose?.();
    navigate(`/swim/${id}/edit`);
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
    // The sheet variant's scroll body runs to the very bottom of the screen
    // (outside Layout), so it needs its own clearance over the safe area /
    // home indicator. The page variant is cleared by Layout's chrome row.
    <div
      className={
        variant === "sheet"
          ? "px-4 pt-2 pb-[calc(max(env(safe-area-inset-bottom),0.75rem)+3.5rem)]"
          : "px-4 pt-2"
      }
    >
      <SpotHeader
        place={place}
        sessions={sessions}
        variant={variant}
        onClose={onClose}
        onShareSpot={onShareSpot}
      />

      <SpotMiniMap place={place} reading={reading} sessions={visibleSessions} />

      {!isGuest ? (
        <ToswimButton onToswim={onToswim} onToggle={onToggleToswim} />
      ) : null}

      {isAdmin ? (
        <SpotAdminBar
          onRename={onAdminRename}
          onDeletePlace={onAdminDeletePlace}
        />
      ) : null}

      <SpotPhotoStrip
        sessions={visibleSessions}
        isAdmin={isAdmin}
        onRemovePhoto={onAdminRemovePhoto}
      />

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

      <WaterTempCard
        reading={reading}
        t={t}
        showHistory={showTempHistory}
        onToggleHistory={() => setShowTempHistory((v) => !v)}
      />

      {showTempHistory ? (
        <SpotTempGraph placeId={place.id} lat={place.lat} lng={place.lng} />
      ) : null}

      <WaterQualityCard sample={waterSample} t={t} />

      {place.nude ? (
        <div className="mt-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50/80 px-3 py-1.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
            {t("spot.nude.badge")}
          </span>
        </div>
      ) : null}

      <SpotInfoCard place={place} onChange={setPlace} />

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
      <SpotRecentDips
        sessions={visibleSessions}
        sessionRefs={sessionRefs}
        focusedSessionId={focusedSessionId}
        myUid={user?.uid}
        isGuest={isGuest}
        isAdmin={isAdmin}
        onShareSession={onShareSession}
        onEditSession={onEditSession}
        onAdminDeleteSession={onAdminDeleteSession}
      />

      <SpotFooterCta isGuest={isGuest} placeId={place.id} />
    </div>
  );
}

/**
 * Fetches the full place doc on demand and subscribes to the spot's live
 * sessions and per-place temperature reading, exposing the freshest known
 * reading and the latest official water sample. Kept in a hook so the view
 * component stays focused on layout.
 */
function useSpotData(placeId: string) {
  const [{ place, loading }, setPlaceState] = useState<{
    place: PlaceDoc | null;
    loading: boolean;
  }>({ place: null, loading: true });
  const setPlace = (next: PlaceDoc) => {
    setPlaceState((current) => ({ ...current, place: next }));
  };
  const [sessions, setSessions] = useState<SessionDoc[]>([]);
  // The live per-place reading (placeTemps/{id}) — fresher than the daily
  // summary once an on-demand refresh has landed. undefined = the snapshot
  // hasn't delivered yet (so we don't fire a refresh against a reading we
  // simply haven't seen); null = the doc doesn't exist.
  const [liveTemp, setLiveTemp] = useState<PlaceTempDoc | null | undefined>(
    undefined,
  );

  useEffect(() => {
    if (!placeId) return;
    let cancelled = false;
    getPlace(placeId).then((p) => {
      if (cancelled) return;
      setPlaceState({ place: p, loading: false });
      return;
    });
    const unsub = watchPlaceSessions(placeId, setSessions);
    const unsubTemp = watchPlaceTemp(placeId, setLiveTemp);
    return () => {
      cancelled = true;
      unsub();
      unsubTemp();
    };
  }, [placeId]);

  // Freshest known reading: the live per-place doc wins over the daily
  // summary entry when both exist (freshestReading validates each side).
  const summaryTemp = useStore((s) => s.tempsByPlace.get(placeId));
  const reading = freshestReading(liveTemp, summaryTemp ?? null);
  const readingAt = reading?.at;
  // Latest official water sample (verdict + algae), from the same summary doc
  // as the temps. Only Hav och Vatten baths with a recent sample have one.
  const waterSample = useStore((s) => s.qualityByPlace.get(placeId));

  // Ask the server for a fresher reading once we know what we already have
  // (both the placeTemps snapshot and the place doc have resolved). The
  // result streams back through the placeTemps subscription above;
  // maybeRefreshPlaceTemp itself gates on staleness, a local throttle, and
  // auth, so re-runs are cheap no-ops.
  useEffect(() => {
    if (!place || liveTemp === undefined) return;
    maybeRefreshPlaceTemp(place.id, readingAt);
  }, [place, liveTemp, readingAt]);

  return { place, loading, setPlace, sessions, reading, waterSample };
}

/** Top row: back/close affordance, spot name + coords/first-dip, share. */
function SpotHeader({
  place,
  sessions,
  variant,
  onClose,
  onShareSpot,
}: {
  place: PlaceDoc;
  sessions: SessionDoc[];
  variant: "page" | "sheet";
  onClose?: () => void;
  onShareSpot: () => void;
}) {
  const navigate = useNavigate();
  const t = useT();
  return (
    <div className="mb-3 flex items-center gap-2">
      <button
        type="button"
        onClick={() => (variant === "sheet" ? onClose?.() : navigate(-1))}
        className="rounded-full bg-white/70 p-2 ring-1 ring-slate-200"
        aria-label={variant === "sheet" ? t("common.close") : t("common.back")}
      >
        {variant === "sheet" ? (
          <X className="h-4 w-4" />
        ) : (
          <ArrowLeft className="h-4 w-4" />
        )}
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
  );
}

/** The mini-map, with the reading merged onto the place so its pin shows temp. */
function SpotMiniMap({
  place,
  reading,
  sessions,
}: {
  place: PlaceDoc;
  reading: TempReading | null;
  sessions: SessionDoc[];
}) {
  // Merge the reading onto the place so the mini-map's own pin still shows
  // the temperature (place docs no longer carry it).
  const placesForMap: PlaceWithTemp[] = !reading
    ? [place]
    : [
        {
          ...place,
          waterTemp: reading.t,
          waterTempAt: reading.at,
          waterTempProvider: reading.p,
        },
      ];
  const sessionsByPlace = new Map<string, SessionDoc[]>();
  sessionsByPlace.set(place.id, sessions);

  return (
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
  );
}

/** "Add to / remove from my to-swim list" toggle. */
function ToswimButton({
  onToswim,
  onToggle,
}: {
  onToswim: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onToggle}
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
  );
}

/** Admin-only rename / delete-spot controls. */
function SpotAdminBar({
  onRename,
  onDeletePlace,
}: {
  onRename: () => void;
  onDeletePlace: () => void;
}) {
  const t = useT();
  return (
    <div className="mt-3 flex flex-wrap gap-2 rounded-2xl bg-amber-50/80 p-2 ring-1 ring-amber-200">
      <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold tracking-widest text-white uppercase">
        {t("admin.label")}
      </span>
      <button
        type="button"
        onClick={onRename}
        className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
      >
        <Pencil className="h-3 w-3" /> {t("admin.rename")}
      </button>
      <button
        type="button"
        onClick={onDeletePlace}
        className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50"
      >
        <Trash2 className="h-3 w-3" /> {t("admin.delete_spot")}
      </button>
    </div>
  );
}

/** Horizontal strip of swim photos (with an admin remove-photo control). */
function SpotPhotoStrip({
  sessions,
  isAdmin,
  onRemovePhoto,
}: {
  sessions: SessionDoc[];
  isAdmin: boolean;
  onRemovePhoto: (id: string) => void;
}) {
  const t = useT();
  const photoSessions = sessions.filter((s) => s.photoUrl);
  if (photoSessions.length === 0) return null;
  return (
    <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4">
      {photoSessions.map((s) => (
        <div
          key={s.id}
          className="relative h-24 w-24 flex-none overflow-hidden rounded-xl ring-1 ring-white/60"
        >
          <SwimPhoto
            session={s}
            sessions={photoSessions}
            className="h-full w-full"
          />
          <span className="pointer-events-none absolute bottom-1 left-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-semibold text-white">
            {s.displayName}
          </span>
          {isAdmin ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemovePhoto(s.id);
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
  );
}

/** The recent-dips list, including the deep-link scroll target refs. */
function SpotRecentDips({
  sessions,
  sessionRefs,
  focusedSessionId,
  myUid,
  isGuest,
  isAdmin,
  onShareSession,
  onEditSession,
  onAdminDeleteSession,
}: {
  sessions: SessionDoc[];
  sessionRefs: RefObject<Map<string, HTMLLIElement>>;
  focusedSessionId: string | null;
  myUid?: string;
  isGuest: boolean;
  isAdmin: boolean;
  onShareSession: (s: SessionDoc) => void;
  onEditSession: (id: string) => void;
  onAdminDeleteSession: (id: string) => void;
}) {
  const t = useT();
  return (
    <ul className="space-y-2">
      {sessions.map((s, i) => (
        <SwimListItem
          key={s.id}
          ref={(el) => {
            if (el) sessionRefs.current.set(s.id, el);
            else sessionRefs.current.delete(s.id);
          }}
          index={i}
          className={
            focusedSessionId === s.id ? "animate-highlight" : undefined
          }
          seed={s.id}
          thumb={
            s.photoUrl ? (
              <SwimPhoto
                session={s}
                sessions={sessions}
                className="h-14 w-14 flex-none rounded-lg ring-1 ring-wave-200 ring-inset"
              />
            ) : undefined
          }
          title={
            <div className="truncate font-semibold text-wave-900">
              {s.displayName}
              {s.uid === myUid ? (
                <span className="ml-1.5 text-[10px] text-wave-600">
                  {t("common.you")}
                </span>
              ) : null}
            </div>
          }
          points={s.points}
          aside={
            <>
              <button
                type="button"
                onClick={() => onShareSession(s)}
                className="rounded-full bg-white/80 p-1 text-wave-700 ring-1 ring-slate-200 hover:bg-white"
                aria-label={t("spot.share_session")}
                title={t("spot.share_session")}
              >
                <Share2 className="h-3 w-3" />
              </button>
              {s.uid === myUid ? (
                <button
                  type="button"
                  onClick={() => onEditSession(s.id)}
                  className="rounded-full bg-white/80 p-1 text-wave-700 ring-1 ring-slate-200 hover:bg-white"
                  aria-label={t("swim.edit")}
                  title={t("swim.edit")}
                >
                  <Pencil className="h-3 w-3" />
                </button>
              ) : null}
              {!isGuest && isAdmin && s.uid !== myUid ? (
                <button
                  type="button"
                  onClick={() => onAdminDeleteSession(s.id)}
                  className="rounded-full bg-white/80 p-1 text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50"
                  aria-label={t("admin.delete_session")}
                  title={t("admin.delete_session")}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              ) : null}
            </>
          }
          date={s.date}
          winter={s.isWinter}
          unique={s.isUniqueForUser}
          waterTemp={s.waterTemp}
          note={s.note}
        >
          <ReactionBar session={s} myUid={myUid} />
        </SwimListItem>
      ))}
      {sessions.length === 0 ? (
        <li className="rounded-2xl bg-white/60 p-6 text-center text-sm text-slate-500">
          {t("spot.empty.all")}
        </li>
      ) : null}
    </ul>
  );
}

/** Bottom call-to-action: sign in (guests) or log a swim here. */
function SpotFooterCta({
  isGuest,
  placeId,
}: {
  isGuest: boolean;
  placeId: string;
}) {
  const t = useT();
  return (
    <div className="mt-6 text-center">
      {isGuest ? (
        <Link
          to="/login"
          onClick={rememberReturnPath}
          className={buttonClasses("primary", "md")}
        >
          <LogIn className="h-3.5 w-3.5" />
          {t("spot.guest.cta")}
        </Link>
      ) : (
        <Link
          to={`/log?placeId=${placeId}`}
          className={buttonClasses("primary", "md")}
        >
          {t("spot.log_here")}
        </Link>
      )}
    </div>
  );
}

export default function SpotPage() {
  const { placeId } = useParams<{ placeId: string }>();
  const t = useT();
  if (!placeId) {
    return (
      <div className="px-4 pt-6 text-center text-sm text-slate-500">
        {t("spot.not_found")}
      </div>
    );
  }
  return <SpotView placeId={placeId} variant="page" />;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function WaterTempCard({
  reading,
  t,
  showHistory,
  onToggleHistory,
}: {
  reading: TempReading | null;
  t: (key: string, vars?: Record<string, string | number>) => string;
  showHistory?: boolean;
  onToggleHistory?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  // The displayed age changes while the card stays open. Keep the clock in an
  // effect rather than reading it during render, which keeps renders pure.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!reading) return null;
  if (now - reading.at > WEEK_MS) return null;

  const ageMs = now - reading.at;
  const ageHrs = Math.floor(ageMs / (60 * 60 * 1000));
  const ageMins = Math.floor(ageMs / 60_000);
  const ageLabel =
    ageMins < 60
      ? t("map.popup.age.mins", { n: ageMins })
      : ageHrs < 24
        ? t("map.popup.age.hrs", { n: ageHrs })
        : t("map.popup.age.days", { n: Math.floor(ageHrs / 24) });

  const isWarm = reading.t >= 17;
  const isCool = reading.t < 10;
  const mutedColor = isWarm
    ? "text-amber-600"
    : isCool
      ? "text-sky-600"
      : "text-teal-600";
  const sourceLabel = t(`temp.source.${reading.p}`);

  return (
    <div
      className={`mt-3 rounded-2xl px-3 py-2.5 ring-1 ${
        isWarm
          ? "bg-amber-50/80 ring-amber-200"
          : isCool
            ? "bg-sky-50/80 ring-sky-200"
            : "bg-teal-50/80 ring-teal-200"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Thermometer
            className={`h-4 w-4 flex-none ${isWarm ? "text-amber-500" : isCool ? "text-sky-500" : "text-teal-500"}`}
          />
          <span
            className={`font-semibold ${isWarm ? "text-amber-900" : isCool ? "text-sky-900" : "text-teal-900"}`}
          >
            {reading.t.toFixed(1)} °C
          </span>
          <span className={`text-xs ${mutedColor} truncate`}>{ageLabel}</span>
        </div>
        {onToggleHistory ? (
          <button
            type="button"
            onClick={onToggleHistory}
            className={`flex-none text-xs font-semibold underline underline-offset-2 hover:opacity-80 ${mutedColor}`}
          >
            {showHistory
              ? t("spot.temp.hide_history")
              : t("spot.temp.show_history")}
          </button>
        ) : null}
      </div>
      {sourceLabel ? (
        <div className={`mt-0.5 pl-[26px] text-[11px] ${mutedColor}`}>
          {t("spot.temp.source", { source: sourceLabel })}
        </div>
      ) : null}
    </div>
  );
}

const QUALITY_PILL: Record<QualitySeverity, string> = {
  ok: "bg-teal-50 text-teal-800 ring-teal-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  bad: "bg-rose-50 text-rose-800 ring-rose-200",
  muted: "bg-slate-50 text-slate-600 ring-slate-200",
};

/**
 * The latest official water sample from Hav och Vatten — the overall verdict
 * (Tjänligt/Otjänligt) and any algae bloom. Renders nothing unless there's a
 * recent sample (official sampling is biweekly; readings older than ~2 weeks
 * are treated as no current data — see lib/waterQuality). The sample date is
 * always shown so the reader can judge freshness.
 */
function WaterQualityCard({
  sample,
  t,
}: {
  sample: WaterSample | undefined;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  if (!sample || !isSampleFresh(sample.at)) return null;

  // Only render codes we have labels for (skip "no data" values).
  const showAlgae = sample.a === 3 || sample.a === 4;
  const showVerdict =
    typeof sample.v === "number" && sample.v >= 1 && sample.v <= 3;
  if (!showAlgae && !showVerdict) return null;

  return (
    <div className="mt-3 rounded-2xl bg-white/70 p-3 ring-1 ring-slate-200">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-wave-900">
        <Droplets className="h-4 w-4 text-wave-600" />
        {t("spot.quality.title")}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {showAlgae ? (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${QUALITY_PILL[algaeSeverity(sample.a)]}`}
          >
            {t(`quality.algae.${sample.a}`)}
          </span>
        ) : null}
        {showVerdict ? (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${QUALITY_PILL[sampleSeverity(sample.v)]}`}
          >
            {t(`quality.sample.${sample.v}`)}
          </span>
        ) : null}
      </div>

      <div className="mt-1.5 text-[11px] text-slate-500">
        {t("spot.quality.sampled", { date: formatDate(sample.at) })}
      </div>
      <div className="mt-0.5 text-[11px] text-slate-400">
        {t("spot.quality.source")}
      </div>
    </div>
  );
}

/** Everything `setPlaceInfo(id, null)` removes server-side, mirrored locally. */
function withoutInfo(place: PlaceDoc): PlaceDoc {
  const copy = { ...place };
  delete copy.info;
  delete copy.infoSource;
  delete copy.infoUrl;
  delete copy.infoBy;
  delete copy.infoByName;
  delete copy.infoUpdatedAt;
  return copy;
}

/**
 * Description of the spot — official text synced from the source feed
 * (with a link back to the original) or user-contributed through the
 * `setPlaceInfo` Cloud Function. Collapsed to a few lines by default
 * (logging swims is the main event); a "show more" toggle appears only
 * when the clamped text actually overflows. When a spot has no info yet,
 * any signed-in user may add some — pre-checked by client moderation for
 * fast feedback and re-checked authoritatively server-side.
 */
function SpotInfoCard({
  place,
  onChange,
}: {
  place: PlaceDoc;
  onChange: (p: PlaceDoc) => void;
}) {
  const { user, profile } = useAuth();
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [nudeDraft, setNudeDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const textRef = useRef<HTMLParagraphElement | null>(null);

  const info = place.info;
  const isAdmin = useIsAdmin();
  // Contributing (info or the naturist flag) requires an established
  // account — MIN_INFO_POINTS total. UX gate; the function re-checks.
  const mayContribute =
    !!user && (isAdmin || totalPoints(profile?.scores) >= MIN_INFO_POINTS);
  const canEdit =
    !!user &&
    mayContribute &&
    (isAdmin || (place.infoSource === "user" && place.infoBy === user.uid));

  // Show the more/less toggle only when the clamped text overflows. Kept
  // under a ResizeObserver because the first paint measures with fallback
  // fonts — once the webfont loads (or the viewport changes) the same text
  // can wrap onto fewer/more lines than measured.
  useEffect(() => {
    if (expanded) return;
    const el = textRef.current;
    if (!el) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [info, expanded]);

  async function save(next: string | null, nude?: boolean) {
    if (!user) return;
    setBusy(true);
    try {
      // UX pre-check only — the Cloud Function re-checks authoritatively.
      if (next) await assertTextAllowed(next);
      const stored = (await setPlaceInfo(place.id, next, nude)).info;
      // Mirror the function's writes locally: unchanged text keeps its
      // attribution, new text becomes the caller's, cleared text goes.
      const updated = stored
        ? stored === place.info
          ? { ...place }
          : {
              ...withoutInfo(place),
              info: stored,
              infoSource: "user",
              infoBy: user.uid,
              infoByName: profile?.displayName ?? "",
              infoUpdatedAt: Date.now(),
            }
        : withoutInfo(place);
      if (nude !== undefined && nude !== (place.nude === true)) {
        updated.nude = nude;
        updated.nudeSource = "user";
      }
      onChange(updated);
      setEditing(false);
      setExpanded(false);
      const removedText = !stored && !!place.info;
      toast.success(t(removedText ? "spot.info.removed" : "spot.info.saved"));
    } catch (err) {
      toast.error(
        t(
          err instanceof ModerationError
            ? "moderation.text_rejected"
            : "spot.info.error",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="mt-3 rounded-2xl bg-white/70 p-3 ring-1 ring-slate-200">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-wave-900">
          <Info className="h-4 w-4 text-wave-600" />
          {t("spot.info.title")}
        </div>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          maxLength={1200}
          placeholder={t("spot.info.placeholder")}
          autoFocus
        />
        <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={nudeDraft}
            onChange={(e) => setNudeDraft(e.target.checked)}
            className="h-4 w-4 flex-none rounded border-slate-300 text-wave-600 focus:ring-wave-400"
          />
          {t("spot.info.nude_label")}
        </label>
        <div className="mt-2 flex items-center gap-2">
          <Button
            size="sm"
            loading={busy}
            disabled={!draft.trim() && nudeDraft === (place.nude === true)}
            onClick={() => save(draft.trim() || null, nudeDraft)}
          >
            {t("spot.info.save")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setEditing(false)}
          >
            {t("common.cancel")}
          </Button>
          {info && canEdit ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => save(null)}
              className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-rose-700 disabled:opacity-60"
            >
              <Trash2 className="h-3 w-3" /> {t("spot.info.remove")}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (!info) {
    if (!mayContribute) return null;
    return (
      <button
        type="button"
        onClick={() => {
          setDraft("");
          setNudeDraft(place.nude === true);
          setEditing(true);
        }}
        className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-xs font-semibold text-wave-700 shadow ring-1 ring-slate-200 transition hover:bg-white active:scale-95"
      >
        <Plus className="h-3.5 w-3.5" /> {t("spot.info.add")}
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-2xl bg-white/70 p-3 ring-1 ring-slate-200">
      <div className="flex items-start gap-2.5">
        <Info className="mt-0.5 h-4 w-4 flex-none text-wave-600" />
        <div className="min-w-0 flex-1">
          <p
            ref={textRef}
            className={`text-sm whitespace-pre-line text-slate-700 ${
              expanded ? "" : "line-clamp-3"
            }`}
          >
            {info}
          </p>
          {clamped || expanded ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-xs font-semibold text-wave-700"
            >
              {expanded ? t("spot.info.less") : t("spot.info.more")}
            </button>
          ) : null}
          <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-500">
            {place.infoSource === "user" ? (
              <span>
                {t("spot.info.by", { name: place.infoByName ?? "?" })}
              </span>
            ) : place.infoUrl ? (
              <a
                href={place.infoUrl}
                target="_blank"
                rel="noreferrer"
                className="underline decoration-slate-300 underline-offset-2 hover:text-wave-700"
              >
                {t("spot.info.source", { source: place.infoSource ?? "" })}
              </a>
            ) : place.infoSource ? (
              <span>{t("spot.info.source", { source: place.infoSource })}</span>
            ) : null}
            {canEdit ? (
              <button
                type="button"
                onClick={() => {
                  setDraft(info);
                  setNudeDraft(place.nude === true);
                  setEditing(true);
                }}
                className="inline-flex items-center gap-1 font-medium text-wave-700"
              >
                <Pencil className="h-3 w-3" /> {t("spot.info.edit")}
              </button>
            ) : null}
          </div>
        </div>
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

type HistoryPoint = { date: string; t: number; p: TempSource };

/** How many days of temperature history the spot graph spans. */
const HISTORY_DAYS = 30;

/**
 * YYYY-MM-DD day key in Sweden's local zone. Must match the `localDay` helper
 * in functions/index.js so the graph lines each stored reading up with the
 * calendar day the swim actually happened — UTC bucketing would shift a
 * late-evening CEST swim into the next day.
 */
const localDay = (ms: number) =>
  new Date(ms).toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });

/** The last HISTORY_DAYS + 1 local day keys, oldest → newest. */
function recentDayKeys(): string[] {
  const keys: string[] = [];
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  for (let i = HISTORY_DAYS; i >= 0; i--) keys.push(localDay(now - i * DAY));
  return keys;
}

function useSpotTempHistory(placeId: string, lat?: number, lng?: number) {
  const [storedHistory, setStoredHistory] =
    useState<PlaceTempHistoryDoc | null>(null);
  const [omPoints, setOmPoints] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  // Remember which coordinates we've already fetched an estimate for, so a
  // later stored-history update (which re-runs the effect) doesn't fire a
  // duplicate upstream request.
  const fetchedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!placeId) return;
    return watchPlaceTempHistory(placeId, setStoredHistory);
  }, [placeId]);

  useEffect(() => {
    if (typeof lat !== "number" || typeof lng !== "number") return;
    const fetchKey = `${lat},${lng}`;
    if (fetchedFor.current === fetchKey) return;

    // Skip the upstream estimate entirely when we already have a stored
    // reading for every day in the window — there's nothing left to fill in.
    const days = recentDayKeys();
    const covered = days.every(
      (d) => typeof storedHistory?.days?.[d]?.t === "number",
    );
    if (covered) {
      setLoading(false);
      return;
    }
    fetchedFor.current = fetchKey;

    let cancelled = false;
    const startStr = days[0];
    const endStr = days[days.length - 1];

    async function loadOm() {
      try {
        // `timezone=Europe/Stockholm` makes Open-Meteo aggregate and label
        // days in the same zone as localDay, so its keys line up with ours.
        const res = await fetch(
          `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&start_date=${startStr}&end_date=${endStr}&daily=sea_surface_temperature_mean&timezone=Europe%2FStockholm`,
          { headers: { Accept: "application/json" } },
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data?.daily?.time) return;
        const times: string[] = data.daily.time;
        const temps: (number | null)[] =
          data.daily.sea_surface_temperature_mean ?? [];
        const result: Record<string, number> = {};
        times.forEach((timeStr, idx) => {
          const val = temps[idx];
          if (typeof val === "number" && !Number.isNaN(val)) {
            result[timeStr] = Math.round(val * 10) / 10;
          }
        });
        setOmPoints(result);
      } catch {
        // Ignored — the graph falls back to whatever stored readings exist.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadOm();

    return () => {
      cancelled = true;
    };
  }, [lat, lng, storedHistory]);

  // Stored readings win over the upstream estimate for each day. Recomputed
  // only when a source changes rather than on every render.
  const points = useMemo<HistoryPoint[]>(() => {
    const result: HistoryPoint[] = [];
    for (const dateStr of recentDayKeys()) {
      const stored = storedHistory?.days?.[dateStr];
      if (stored && typeof stored.t === "number") {
        result.push({ date: dateStr, t: stored.t, p: stored.p });
      } else if (omPoints[dateStr] != null) {
        result.push({ date: dateStr, t: omPoints[dateStr], p: "open-meteo" });
      }
    }
    return result;
  }, [storedHistory, omPoints]);

  return { points, loading };
}

function SpotTempGraph({
  placeId,
  lat,
  lng,
}: {
  placeId: string;
  lat?: number;
  lng?: number;
}) {
  const t = useT();
  const { points, loading } = useSpotTempHistory(placeId, lat, lng);
  const [selectedPoint, setSelectedPoint] = useState<HistoryPoint | null>(null);

  if (loading && points.length === 0) {
    return (
      <div className="mt-3 flex h-28 items-center justify-center rounded-2xl bg-white/60 ring-1 ring-white/60">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-teal-600 border-r-transparent" />
      </div>
    );
  }

  if (points.length < 2) {
    return (
      <div className="mt-3 rounded-2xl bg-white/60 p-4 text-center text-xs text-slate-500 ring-1 ring-white/60">
        {t("spot.temp.graph_nodata")}
      </div>
    );
  }

  const temps = points.map((p) => p.t);
  const minTemp = Math.floor(Math.min(...temps) - 1);
  const maxTemp = Math.ceil(Math.max(...temps) + 1);
  const range = Math.max(1, maxTemp - minTemp);
  const avgTemp = (temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1);

  const width = 320;
  const height = 110;
  const padLeft = 24;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 20;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const coords = points.map((p, i) => {
    const x = padLeft + (i / (points.length - 1)) * chartW;
    const y = padTop + chartH - ((p.t - minTemp) / range) * chartH;
    return { x, y, point: p };
  });

  const pathD = coords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(" ");

  const areaD = `${pathD} L ${coords[coords.length - 1].x.toFixed(1)} ${height - padBottom} L ${coords[0].x.toFixed(1)} ${height - padBottom} Z`;

  const active = selectedPoint ?? points[points.length - 1];

  return (
    <div className="mt-3 rounded-2xl bg-gradient-to-br from-teal-50/90 to-sky-50/90 p-3 ring-1 ring-teal-200/80">
      <div className="flex items-center justify-between text-xs font-semibold text-teal-900">
        <div className="flex items-center gap-1.5">
          <Thermometer className="h-4 w-4 text-teal-600" />
          <div className="flex flex-col leading-tight">
            <span>{t("spot.temp.graph_title")}</span>
            <span className="text-[10px] font-medium text-teal-600/80">
              {t("spot.temp.history_days")}
            </span>
          </div>
        </div>
        <div className="text-[11px] font-medium text-teal-700">
          {t("spot.temp.graph_avg", { temp: avgTemp })}
        </div>
      </div>

      {active ? (
        <div className="mt-1 flex items-center justify-between text-[11px] text-teal-800">
          <span className="font-semibold">
            {formatDate(new Date(active.date).getTime())}
          </span>
          <span className="font-bold text-teal-900">
            {active.t}°C{" "}
            <span className="font-normal text-slate-500">
              ({t(`temp.source.${active.p}`)})
            </span>
          </span>
        </div>
      ) : null}

      <div className="relative mt-2">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full overflow-visible"
        >
          <defs>
            <linearGradient id="tempGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          <line
            x1={padLeft}
            y1={padTop}
            x2={width - padRight}
            y2={padTop}
            stroke="#99f6e4"
            strokeDasharray="2,2"
            strokeWidth="1"
          />
          <line
            x1={padLeft}
            y1={padTop + chartH / 2}
            x2={width - padRight}
            y2={padTop + chartH / 2}
            stroke="#99f6e4"
            strokeDasharray="2,2"
            strokeWidth="1"
          />
          <line
            x1={padLeft}
            y1={height - padBottom}
            x2={width - padRight}
            y2={height - padBottom}
            stroke="#99f6e4"
            strokeDasharray="2,2"
            strokeWidth="1"
          />

          <text
            x={padLeft - 4}
            y={padTop + 3}
            textAnchor="end"
            fontSize="8"
            fill="#0f766e"
            fontWeight="bold"
          >
            {maxTemp}°
          </text>
          <text
            x={padLeft - 4}
            y={height - padBottom + 3}
            textAnchor="end"
            fontSize="8"
            fill="#0f766e"
            fontWeight="bold"
          >
            {minTemp}°
          </text>

          <path d={areaD} fill="url(#tempGradient)" />
          <path
            d={pathD}
            fill="none"
            stroke="#0d9488"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {coords.map((c) => {
            const isSelected = active?.date === c.point.date;
            return (
              <g key={c.point.date}>
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={isSelected ? "4.5" : "2.5"}
                  className="cursor-pointer transition-all"
                  fill={isSelected ? "#0f766e" : "#0d9488"}
                  stroke="#ffffff"
                  strokeWidth={isSelected ? "2" : "1"}
                  onClick={() => setSelectedPoint(c.point)}
                  onMouseEnter={() => setSelectedPoint(c.point)}
                />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
