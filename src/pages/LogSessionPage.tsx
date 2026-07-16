import { useEffect, useReducer, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { m, AnimatePresence } from "framer-motion";
import {
  MapPin,
  Crosshair,
  CalendarDays,
  Camera,
  X,
  Sparkles,
  Search,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useAllSessionsFeed, useStore } from "@/store/sessions";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import SwimMap from "@/components/SwimMap";
import { toast } from "@/components/ui/toastStore";
import { celebrate } from "@/components/celebrationStore";
import {
  createSession,
  findOrCreatePlace,
  updateUserLastLocation,
} from "@/lib/data";
import { checkImageFile, ImageProcessingError } from "@/lib/image";
import { assertTextAllowed, ModerationError } from "@/lib/moderation";
import { reverseGeocodeCountry } from "@/lib/geocode";
import { getPosition, haversineMeters } from "@/lib/utils";
import {
  PLACE_RADIUS_METERS,
  isWinterMonth,
  previewPoints,
} from "@/lib/scoring";
import { resolveBorder } from "@/lib/borders";
import {
  computeStreak,
  streakLevel,
  streakTier,
  SWIM_DAYS_PER_SKIP,
} from "@/lib/streak";
import { useLocale, useT } from "@/lib/i18n";
import BackButton from "@/components/ui/BackButton";
import SegmentedControl from "@/components/ui/SegmentedControl";
import { usePosition } from "@/hooks/position";
import type { PlaceWithTemp } from "@/lib/types";

type Mode = "now" | "pick";

type Coords = { lat: number; lng: number };

type PlacePin = PlaceWithTemp;
type PlaceList = PlaceWithTemp[];

type LogLocationState = {
  mode: Mode;
  name: string;
  date: string;
  coords: Coords | null;
  search: string;
  pickedPlaceId: string | null;
  fixDeadline: boolean;
  locating: boolean;
};

function logLocationReducer(
  state: LogLocationState,
  patch: Partial<LogLocationState>,
): LogLocationState {
  return { ...state, ...patch };
}

// A spot pin marks one point on what can be a large beach — be lax about
// how far away the swimmer can stand and still count as "at" the spot.
const NOW_ATTACH_RADIUS_METERS = 800;
// Never conclude "no spot nearby" from a fix that is itself less precise
// than this — the first fix from a cold GPS is routinely hundreds of
// meters off (enableHighAccuracy only turns the GPS on, it doesn't make
// the first callback wait for it).
const NOW_FALLBACK_ACCURACY_METERS = 500;
// How long to wait for a trustworthy fix before deciding with what we have.
const NOW_FIX_DEADLINE_MS = 10_000;

export default function LogSessionPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const t = useT();
  // The native datetime-local picker formats date + 12h/24h time from
  // the input's own `lang`, not from <html lang>. en-GB → 24h with sane
  // day-first format, sv-SE → Swedish month names + 24h. Safari obeys
  // this where it ignores the page locale entirely.
  const locale = useLocale((s) => s.locale);
  const inputLang = locale === "sv" ? "sv-SE" : "en-GB";
  const places = useStore((s) => s.placesWithTemps);
  const mySessions = useStore((s) => s.mySessions);
  const myPlaceIds = useStore((s) => s.myPlaceIds);
  const unlockedAchievements = useStore((s) => s.unlockedAchievements);
  const sessionsByPlace = useStore((s) => s.sessionsByPlace);
  // Live GPS fix for the "current position" (blue) dot on the map. Falls back
  // to the last known location while GPS resolves; null until we have either,
  // so we never plant a "you are here" dot at a hardcoded guess.
  const myLocation = usePosition();
  // Pin popups + achievement checks read the community feed — keep it
  // subscribed while logging (this page is behind login).
  useAllSessionsFeed();

  // Pre-select a place when navigating from SpotPage (?placeId=xxx).
  const preselectedPlaceId = searchParams.get("placeId");
  const preselectedPlace = preselectedPlaceId
    ? (places.find((p) => p.id === preselectedPlaceId) ?? null)
    : null;

  const {
    state: { mode, name, date, coords, search, pickedPlaceId, locating },
    updateLocation,
    setIntentionalNow,
    searchOrigin,
    swimMapRef,
    countryRef,
    searchMatches,
    suggestion,
  } = useLogLocation({
    preselectedPlaceId,
    preselectedPlace,
    places,
    user,
    profile,
  });

  const [note, setNote] = useState("");
  const { photoFileRef, photoPreview, photoInput, onPhotoChange, clearPhoto } =
    usePhotoUpload();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user || !profile) return;
    if (!coords) {
      toast.error(t("log.error.location"));
      return;
    }
    const finalName = (name || suggestion || "").trim();
    if (!finalName) {
      toast.error(t("log.error.name"));
      return;
    }
    const ts = mode === "now" ? Date.now() : new Date(date).getTime();
    if (Number.isNaN(ts)) {
      toast.error(t("log.error.date"));
      return;
    }
    setBusy(true);
    try {
      // Pre-check the note before the (potentially slow) photo upload —
      // the logSession function re-checks it authoritatively anyway.
      if (note.trim()) await assertTextAllowed(note);
      const place = await findOrCreatePlace({
        name: finalName,
        lat: coords.lat,
        lng: coords.lng,
        createdBy: user.uid,
        date: ts,
        existingPlaces: places,
      });
      // Rate limit: max one swim per hour at the same place. A violation
      // implies an earlier session at this place, so `place` can't be a
      // just-created orphan when we bail here.
      const HOUR_MS = 3_600_000;
      if (
        mySessions.some(
          (s) => s.placeId === place.id && Math.abs(s.date - ts) < HOUR_MS,
        )
      ) {
        toast.error(t("log.error.too_soon"));
        setBusy(false);
        return;
      }
      const myBorder = resolveBorder(
        profile.selectedBorder,
        unlockedAchievements.size,
        unlockedAchievements,
      );
      const session = await createSession({
        uid: user.uid,
        place,
        lat: coords.lat,
        lng: coords.lng,
        date: ts,
        note,
        photoFile: photoFileRef.current,
        country: countryRef.current,
        border: myBorder.id,
      });
      celebrate.swim(session.points, session.isUniqueForUser, session.isWinter);
      // Streak feedback, computed against the pre-log session list: crossing
      // a tier (3/7/30) or an intensity step within one (10/20/40/50) queues
      // a celebration after the swim splash; banking a new life buoy (every
      // 4th swim day) gets a toast.
      const dates = mySessions.map((s) => s.date);
      const before = computeStreak(dates);
      const after = computeStreak([...dates, ts]);
      const tier = streakTier(after.current);
      if (
        after.current > before.current &&
        tier !== "plain" &&
        (tier !== streakTier(before.current) ||
          streakLevel(after.current) > streakLevel(before.current))
      ) {
        celebrate.streak(tier, after.current);
      } else if (
        after.currentStart !== null &&
        Math.floor(after.swimDays / SWIM_DAYS_PER_SKIP) >
          Math.floor(before.swimDays / SWIM_DAYS_PER_SKIP)
      ) {
        toast.success(t("log.buoy_earned"));
      }
      navigate("/history");
    } catch (err) {
      // A too-large / unreadable photo gets a specific message, a name or
      // note rejected by moderation gets another; everything else falls
      // back to the generic "couldn't save".
      if (err instanceof ImageProcessingError) {
        toast.error(
          t(
            err.reason === "too-large"
              ? "log.error.image_too_large"
              : "log.error.image_failed",
          ),
        );
      } else if (err instanceof ModerationError) {
        toast.error(t("moderation.text_rejected"));
      } else {
        toast.error(t("log.error.generic"));
      }
    }
    setBusy(false);
  }

  const dateObj = new Date(date);
  const isWinterSwim = isWinterMonth(dateObj);
  // "New spot" = a place the user hasn't logged before. A brand-new pin
  // (no pickedPlaceId) is always new; a picked existing place is new only
  // if it's not already in the user's own history.
  const isNewSpot = !pickedPlaceId || !myPlaceIds.has(pickedPlaceId);
  const pointsPreview = previewPoints({
    isNewSpot,
    isWinter: isWinterSwim,
  });

  return (
    <form onSubmit={submit} className="px-4 pt-2 pb-10">
      <div className="mb-3 flex items-center justify-between">
        <BackButton />
        <h2 className="font-display text-xl font-black text-wave-900">
          {t("log.title")}
        </h2>
        <span className="w-8" />
      </div>

      <SegmentedControl
        value={mode}
        onChange={(next) => {
          setIntentionalNow(next === "now");
          updateLocation({ mode: next });
        }}
        options={[
          {
            value: "now",
            label: (
              <>
                <Crosshair className="h-3.5 w-3.5" /> {t("log.mode.now")}
              </>
            ),
          },
          {
            value: "pick",
            label: (
              <>
                <CalendarDays className="h-3.5 w-3.5" /> {t("log.mode.pick")}
              </>
            ),
          },
        ]}
      />

      <p className="mt-2 px-1 text-center text-[11px] text-slate-500">
        {mode === "now" ? t("log.mode.now.hint") : t("log.mode.pick.hint")}
      </p>

      <AnimatePresence mode="wait">
        <m.div
          key={mode}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className="mt-4 space-y-4"
        >
          {mode === "pick" ? (
            <PlaceSearch
              search={search}
              searchMatches={searchMatches}
              coords={coords}
              searchOrigin={searchOrigin}
              updateLocation={updateLocation}
              swimMapRef={swimMapRef}
            />
          ) : null}

          <LogMap
            places={places}
            sessionsByPlace={sessionsByPlace}
            preselectedPlace={preselectedPlace}
            searchOrigin={searchOrigin}
            mode={mode}
            coords={coords}
            pickedPlaceId={pickedPlaceId}
            myLocation={myLocation}
            updateLocation={updateLocation}
            swimMapRef={swimMapRef}
          />

          <LocationBadge
            coords={coords}
            mode={mode}
            pickedPlaceId={pickedPlaceId}
            suggestion={suggestion}
            locating={locating}
          />

          <SpotNameField
            coords={coords}
            pickedPlaceId={pickedPlaceId}
            name={name}
            suggestion={suggestion}
            updateLocation={updateLocation}
          />

          <WhenField
            date={date}
            inputLang={inputLang}
            mode={mode}
            isNewSpot={isNewSpot}
            isWinterSwim={isWinterSwim}
            pointsPreview={pointsPreview}
            updateLocation={updateLocation}
          />

          <div className="space-y-1.5">
            <Label htmlFor="note">{t("log.field.note")}</Label>
            <Textarea
              id="note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("log.field.note.placeholder")}
            />
          </div>

          <PhotoField
            photoPreview={photoPreview}
            photoInput={photoInput}
            onPhotoChange={onPhotoChange}
            clearPhoto={clearPhoto}
          />

          <Button type="submit" loading={busy} size="lg" className="w-full">
            {t("log.save")} <Sparkles className="h-4 w-4" />
          </Button>
        </m.div>
      </AnimatePresence>
    </form>
  );
}

// --- Location state + geolocation logic ------------------------------------

type UseLogLocationArgs = {
  preselectedPlaceId: string | null;
  preselectedPlace: PlacePin | null;
  places: PlaceList;
  user: ReturnType<typeof useAuth>["user"];
  profile: ReturnType<typeof useAuth>["profile"];
};

// Owns the location reducer plus every geolocation-driven effect: the
// distance-sorting origin fix, the fly-to-user pass, reverse-geocoding for
// the swim country, the "now" mode auto-attach, the position watch, and the
// debounced search/suggestion derivations.
function useLogLocation({
  preselectedPlaceId,
  preselectedPlace,
  places,
  user,
  profile,
}: UseLogLocationArgs) {
  const t = useT();

  const [state, updateLocation] = useReducer(logLocationReducer, {
    mode: preselectedPlaceId ? "pick" : "now",
    name: preselectedPlace?.name ?? "",
    date: toLocalInput(new Date()),
    coords: preselectedPlace
      ? { lat: preselectedPlace.lat, lng: preselectedPlace.lng }
      : null,
    search: "",
    pickedPlaceId: preselectedPlaceId,
    fixDeadline: false,
    locating: false,
  });
  const { mode, coords, search, pickedPlaceId, fixDeadline } = state;

  const countryRef = useRef<string | null>(null);
  const [searchOrigin, setSearchOrigin] = useState<Coords | null>(
    profile?.lastLocation ?? { lat: 57.3298, lng: 12.1393 },
  );
  const swimMapRef = useRef<import("leaflet").Map | null>(null);
  const hasFlownToUserRef = useRef(false);
  // Tracks whether we've already done the "auto-attach to nearest place"
  // check for the current "now" mode entry. Reset each time the user
  // re-enters now mode so we run once per session.
  const autoPickedNowRef = useRef(false);
  // Accuracy (meters) of the geolocation fix behind the current coords —
  // null until the first fix of a now-mode entry arrives.
  const fixAccuracyRef = useRef<number | null>(null);
  // Flips when a now-mode entry has waited NOW_FIX_DEADLINE_MS without a
  // trustworthy fix, forcing the auto-attach decision with what we have.
  // True from now-mode entry until the auto-attach decision (or a
  // geolocation failure) — drives the non-blocking "waiting for GPS" hint.
  // Mirror so the position-watch callback (async) sees the current pick
  // without re-subscribing. Updated from an effect, not during render.
  const pickedPlaceIdRef = useRef(pickedPlaceId);
  useEffect(() => {
    pickedPlaceIdRef.current = pickedPlaceId;
  }, [pickedPlaceId]);
  // Set when the user explicitly clicks the "now" tab — suppresses the
  // auto-fallback to "pick" mode when no nearby place is found so the
  // user's intentional choice is respected.
  const intentionalNowRef = useRef(false);
  const setIntentionalNow = (v: boolean) => {
    intentionalNowRef.current = v;
  };

  // Geolocate once just for sorting search results by distance — works
  // even in "pick" mode where coords aren't auto-set from geolocation.
  // Initialised above with a fallback; here we override with the real position.
  useEffect(() => {
    void getPosition().then(async (pos) => {
      if (!pos) return;
      const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setSearchOrigin(loc);
      if (user) await updateUserLastLocation(user.uid, loc.lat, loc.lng);
    });
  }, [user]);

  // Once we know the user's location, fly the map there at a close zoom
  // (runs once per page load — subsequent changes are handled by keepCenteredOn).
  useEffect(() => {
    if (!searchOrigin || hasFlownToUserRef.current || preselectedPlace) return;
    hasFlownToUserRef.current = true;
    swimMapRef.current?.flyTo([searchOrigin.lat, searchOrigin.lng], 13, {
      duration: 0.8,
    });
  }, [searchOrigin, preselectedPlace]);

  // Reverse-geocode whenever coordinates change so we know what country
  // the swim is in. Falls back silently — scoring handles a null country.
  useEffect(() => {
    if (!coords) {
      countryRef.current = null;
      return;
    }
    const ctrl = new AbortController();
    reverseGeocodeCountry(coords.lat, coords.lng, ctrl.signal).then((c) => {
      if (!ctrl.signal.aborted) countryRef.current = c;
      return;
    });
    return () => ctrl.abort();
  }, [coords]);

  // While in "now" mode, auto-attach to the nearest existing place within
  // NOW_ATTACH_RADIUS_METERS. Attaches eagerly on the first fix that puts a
  // known place in range, but only gives up once the fix is trustworthy or
  // the deadline has passed — deciding on the first (often coarse) fix used
  // to fail the radius check spuriously. Decides once per now-mode entry so
  // the user can clear the lock without it snapping back.
  useEffect(() => {
    if (mode !== "now") return;
    if (!coords) return;
    if (autoPickedNowRef.current) return;
    if (pickedPlaceId) return;
    let best: { p: PlacePin; dist: number } | null = null;
    for (const p of places) {
      const d = haversineMeters(coords, p);
      if (d <= NOW_ATTACH_RADIUS_METERS && (!best || d < best.dist))
        best = { p, dist: d };
    }
    if (best) {
      autoPickedNowRef.current = true;
      updateLocation({
        locating: false,
        coords: { lat: best.p.lat, lng: best.p.lng },
        name: best.p.name,
        pickedPlaceId: best.p.id,
      });
      return;
    }
    // Nothing in range. Hold off on the fallback until the fix is precise
    // enough to trust that — the position watch keeps refining coords and
    // will re-run this effect.
    const accuracy = fixAccuracyRef.current;
    if (
      (accuracy === null || accuracy > NOW_FALLBACK_ACCURACY_METERS) &&
      !fixDeadline
    )
      return;
    autoPickedNowRef.current = true;
    updateLocation({ locating: false });
    if (places.length > 0 && !intentionalNowRef.current) {
      // No known place nearby — switch to pick-on-map so the user can
      // drop a pin at their actual location. Skip when the user explicitly
      // chose "now" mode so their intentional choice is respected.
      updateLocation({ mode: "pick" });
    }
  }, [mode, coords, places, pickedPlaceId, fixDeadline]);

  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(id);
  }, [search]);

  // Pre-compute lowercased names once when places change — avoids calling
  // .toLowerCase() on every place for every search keystroke.
  const placesWithKey = places.map((p) => ({ p, key: p.name.toLowerCase() }));

  const searchMatches = (() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return [];
    const origin = coords ?? searchOrigin;
    // One pass over the (potentially large) place list per keystroke.
    const matches: PlacePin[] = [];
    for (const { p, key } of placesWithKey) {
      if (key.includes(q)) matches.push(p);
    }
    if (origin) {
      matches.sort(
        (a, b) => haversineMeters(origin, a) - haversineMeters(origin, b),
      );
    }
    return matches.slice(0, 5);
  })();

  const suggestion = (() => {
    if (!coords) return null;
    let best: { name: string; dist: number } | null = null;
    for (const p of places) {
      const d = haversineMeters(coords, p);
      if (d < PLACE_RADIUS_METERS && (!best || d < best.dist))
        best = { name: p.name, dist: d };
    }
    return best?.name ?? null;
  })();

  useEffect(() => {
    if (mode !== "now") return;
    updateLocation({
      pickedPlaceId: null,
      name: "",
      search: "",
      fixDeadline: false,
      date: toLocalInput(new Date()),
      locating: true,
    });
    autoPickedNowRef.current = false;
    fixAccuracyRef.current = null;
    if (!navigator.geolocation) {
      toast.error(t("log.geo.unavailable"));
      updateLocation({ mode: "pick", locating: false });
      return;
    }
    // Watch rather than getCurrentPosition: the one-shot returns the first
    // fix the OS can produce, which on a cold GPS is a coarse cell/Wi-Fi
    // position. Watching lets coords sharpen until the auto-attach effect
    // has something it can trust.
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        // Stop updating once a spot is locked in — a later fix would drag
        // coords away from the attached place (and findOrCreatePlace would
        // then mint a near-duplicate on submit).
        if (autoPickedNowRef.current || pickedPlaceIdRef.current) return;
        fixAccuracyRef.current = pos.coords.accuracy;
        updateLocation({
          coords: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        });
      },
      () => {
        // A watch can emit transient errors after a good fix — only bail
        // when we never got a position at all.
        if (fixAccuracyRef.current !== null) return;
        updateLocation({ locating: false });
        toast.error(t("log.geo.failed"));
        updateLocation({ mode: "pick" });
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
    const deadline = setTimeout(
      () => updateLocation({ fixDeadline: true }),
      NOW_FIX_DEADLINE_MS,
    );
    return () => {
      navigator.geolocation.clearWatch(watchId);
      clearTimeout(deadline);
      updateLocation({ locating: false });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return {
    state,
    updateLocation,
    setIntentionalNow,
    searchOrigin,
    swimMapRef,
    countryRef,
    searchMatches,
    suggestion,
  };
}

// --- Photo picker ----------------------------------------------------------

// Owns the photo file (kept in a ref so it isn't a render dependency), its
// preview URL, and the file-input element + handlers.
function usePhotoUpload() {
  const t = useT();
  const photoFileRef = useRef<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  async function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    // Reject oversized / unsupported images right away so the user gets a
    // clear message instead of a failed (or hung) upload at submit time.
    const reason = await checkImageFile(f);
    if (reason) {
      toast.error(
        t(
          reason === "too-large"
            ? "log.error.image_too_large"
            : "log.error.image_failed",
        ),
      );
      if (photoInput.current) photoInput.current.value = "";
      return;
    }
    photoFileRef.current = f;
    setPhotoPreview(URL.createObjectURL(f));
  }

  function clearPhoto() {
    photoFileRef.current = null;
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    if (photoInput.current) photoInput.current.value = "";
  }

  return { photoFileRef, photoPreview, photoInput, onPhotoChange, clearPhoto };
}

// --- Form section subcomponents --------------------------------------------

type UpdateLocation = (patch: Partial<LogLocationState>) => void;
type MapRef = React.RefObject<import("leaflet").Map | null>;

function LogMap({
  places,
  sessionsByPlace,
  preselectedPlace,
  searchOrigin,
  mode,
  coords,
  pickedPlaceId,
  myLocation,
  updateLocation,
  swimMapRef,
}: {
  places: PlaceList;
  sessionsByPlace: React.ComponentProps<typeof SwimMap>["sessionsByPlace"];
  preselectedPlace: PlacePin | null;
  searchOrigin: Coords | null;
  mode: Mode;
  coords: Coords | null;
  pickedPlaceId: string | null;
  myLocation: Coords | null;
  updateLocation: UpdateLocation;
  swimMapRef: MapRef;
}) {
  return (
    <div className="relative h-[40vh] overflow-hidden rounded-2xl border border-white/60 shadow-sm">
      <div className="absolute inset-0">
        <SwimMap
          places={places}
          sessionsByPlace={sessionsByPlace}
          center={
            preselectedPlace
              ? [preselectedPlace.lat, preselectedPlace.lng]
              : searchOrigin
                ? [searchOrigin.lat, searchOrigin.lng]
                : [57.3298, 12.1393]
          }
          zoom={preselectedPlace ? 14 : 13}
          skipInitialFit
          onPick={
            mode === "pick"
              ? (lat, lng) => {
                  // Snap to the nearest existing place if the tap
                  // lands inside its merge radius — otherwise the
                  // user ends up with two near-identical pins.
                  let snap: {
                    id: string;
                    lat: number;
                    lng: number;
                    name: string;
                    dist: number;
                  } | null = null;
                  for (const p of places) {
                    const d = haversineMeters({ lat, lng }, p);
                    if (d <= PLACE_RADIUS_METERS && (!snap || d < snap.dist)) {
                      snap = {
                        id: p.id,
                        lat: p.lat,
                        lng: p.lng,
                        name: p.name,
                        dist: d,
                      };
                    }
                  }
                  if (snap) {
                    updateLocation({
                      coords: { lat: snap.lat, lng: snap.lng },
                      name: snap.name,
                      pickedPlaceId: snap.id,
                    });
                  } else {
                    updateLocation({
                      coords: { lat, lng },
                      name: "",
                      pickedPlaceId: null,
                    });
                  }
                }
              : undefined
          }
          onPickExisting={(p) => {
            updateLocation({
              coords: { lat: p.lat, lng: p.lng },
              name: p.name,
              pickedPlaceId: p.id,
            });
            swimMapRef.current?.flyTo([p.lat, p.lng], 14, {
              duration: 0.8,
            });
          }}
          pickedAt={coords}
          userLocation={myLocation}
          linkToSpot={false}
          activePlaceId={pickedPlaceId}
          lockPan={mode === "now"}
          keepCenteredOn={mode === "now" ? (searchOrigin ?? coords) : null}
          canPickExisting={
            mode === "now"
              ? (p) => {
                  const origin = searchOrigin ?? coords;
                  if (!origin) return true;
                  return haversineMeters(origin, p) <= 1500;
                }
              : undefined
          }
          mapRef={swimMapRef}
        />
      </div>
    </div>
  );
}

function PlaceSearch({
  search,
  searchMatches,
  coords,
  searchOrigin,
  updateLocation,
  swimMapRef,
}: {
  search: string;
  searchMatches: PlaceList;
  coords: Coords | null;
  searchOrigin: Coords | null;
  updateLocation: UpdateLocation;
  swimMapRef: MapRef;
}) {
  const t = useT();
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <Input
        placeholder={t("log.search.placeholder")}
        value={search}
        onChange={(e) => updateLocation({ search: e.target.value })}
        className="pl-9 shadow-sm"
      />
      {searchMatches.length > 0 ? (
        <ul className="absolute top-full right-0 left-0 z-[1100] mt-1 overflow-hidden rounded-xl bg-white/95 shadow-md ring-1 ring-slate-200">
          {searchMatches.map((p) => {
            const origin = coords ?? searchOrigin;
            const dist = origin ? haversineMeters(origin, p) : null;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    updateLocation({
                      coords: { lat: p.lat, lng: p.lng },
                      name: p.name,
                      pickedPlaceId: p.id,
                      search: "",
                    });
                    swimMapRef.current?.flyTo([p.lat, p.lng], 14, {
                      duration: 0.8,
                    });
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-wave-50"
                >
                  <MapPin className="h-3.5 w-3.5 text-wave-600" />
                  <span className="flex-1 truncate">{p.name}</span>
                  {dist != null ? (
                    <span className="text-[10px] text-slate-400">
                      {formatDistance(dist)}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function LocationBadge({
  coords,
  mode,
  pickedPlaceId,
  suggestion,
  locating,
}: {
  coords: Coords | null;
  mode: Mode;
  pickedPlaceId: string | null;
  suggestion: string | null;
  locating: boolean;
}) {
  const t = useT();
  return (
    <div className="rounded-2xl bg-white/70 p-3 ring-1 ring-white/60">
      <div className="flex items-center gap-2 text-xs text-slate-600">
        <MapPin className="h-3.5 w-3.5 shrink-0 text-wave-600" />
        {coords ? (
          <span className="flex flex-1 items-center gap-2">
            {pickedPlaceId ? (
              <span className="chip bg-slate-100 text-slate-700 ring-slate-200">
                📍 {t("log.badge.existing_spot")}
              </span>
            ) : (
              <span className="chip bg-emerald-100 text-emerald-800 ring-emerald-200">
                ✨ {t("log.badge.new_spot")}
              </span>
            )}
            <span className="text-slate-500">
              {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
              {suggestion ? (
                <span className="ml-1 text-wave-700">
                  · {t("log.coords.near", { name: suggestion })}
                </span>
              ) : null}
            </span>
            {locating && !pickedPlaceId ? (
              <span className="ml-auto flex shrink-0 items-center gap-1.5 text-wave-700">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent" />
                {t("log.coords.locking")}
              </span>
            ) : null}
          </span>
        ) : mode === "now" ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-wave-600 border-r-transparent" />
            {t("log.coords.reading")}
          </span>
        ) : (
          <span>{t("log.empty.pick")}</span>
        )}
      </div>
    </div>
  );
}

function SpotNameField({
  coords,
  pickedPlaceId,
  name,
  suggestion,
  updateLocation,
}: {
  coords: Coords | null;
  pickedPlaceId: string | null;
  name: string;
  suggestion: string | null;
  updateLocation: UpdateLocation;
}) {
  const t = useT();
  return (
    <div className="space-y-1.5">
      <Label htmlFor="name">
        {coords && !pickedPlaceId
          ? t("log.field.spot_name.new")
          : t("log.field.spot_name")}
      </Label>
      <div className="relative">
        <Input
          id="name"
          placeholder={suggestion ?? t("log.field.spot_name.placeholder")}
          value={name}
          onChange={(e) => updateLocation({ name: e.target.value })}
          disabled={!!pickedPlaceId}
          readOnly={!!pickedPlaceId}
          className={pickedPlaceId ? "bg-slate-100 pr-9" : undefined}
        />
        {pickedPlaceId ? (
          <button
            type="button"
            onClick={() => {
              updateLocation({ pickedPlaceId: null, name: "" });
            }}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-white p-1 text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50"
            aria-label={t("log.field.spot_name.unlock")}
            title={t("log.field.spot_name.unlock")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {pickedPlaceId ? (
        <p className="text-[11px] text-slate-500">
          {t("log.field.spot_name.locked_hint")}
        </p>
      ) : null}
    </div>
  );
}

function WhenField({
  date,
  inputLang,
  mode,
  isNewSpot,
  isWinterSwim,
  pointsPreview,
  updateLocation,
}: {
  date: string;
  inputLang: string;
  mode: Mode;
  isNewSpot: boolean;
  isWinterSwim: boolean;
  pointsPreview: number;
  updateLocation: UpdateLocation;
}) {
  const t = useT();
  return (
    <div className="space-y-1.5">
      <Label htmlFor="date">{t("log.field.when")}</Label>
      <Input
        id="date"
        type="datetime-local"
        lang={inputLang}
        value={date}
        onChange={(e) => updateLocation({ date: e.target.value })}
        disabled={mode === "now"}
        readOnly={mode === "now"}
        className={mode === "now" ? "bg-slate-100 text-slate-500" : undefined}
      />
      {mode === "now" ? (
        <div className="text-[11px] text-slate-500">
          {t("log.field.when.now_hint")}
        </div>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <div className="chip bg-wave-100 text-wave-800 ring-wave-200">
          💧 {t("log.points.swim")}
        </div>
        {isNewSpot ? (
          <div className="chip bg-emerald-100 text-emerald-800 ring-emerald-200">
            ✨ {t("log.points.new_spot")}
          </div>
        ) : null}
        {isWinterSwim ? (
          <div className="chip bg-sky-100 text-sky-800 ring-sky-200">
            ❄️ {t("log.points.winter")}
          </div>
        ) : null}
        <span className="ml-auto font-display text-sm font-black text-wave-700">
          {t("log.points.total", { n: pointsPreview })}
        </span>
      </div>
    </div>
  );
}

function PhotoField({
  photoPreview,
  photoInput,
  onPhotoChange,
  clearPhoto,
}: {
  photoPreview: string | null;
  photoInput: React.RefObject<HTMLInputElement | null>;
  onPhotoChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  clearPhoto: () => void;
}) {
  const t = useT();
  return (
    <div className="space-y-1.5">
      <Label>{t("log.field.photo")}</Label>
      {photoPreview ? (
        <div className="relative overflow-hidden rounded-xl">
          <img src={photoPreview} alt="" className="h-44 w-full object-cover" />
          <button
            type="button"
            onClick={clearPhoto}
            className="absolute top-2 right-2 rounded-full bg-black/60 p-1 text-white"
            aria-label={t("log.remove_photo")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => photoInput.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white/60 py-6 text-sm text-slate-500 hover:bg-white/90"
        >
          <Camera className="h-4 w-4" />
          {t("log.add_photo")}
        </button>
      )}
      {/* No `capture` attribute — that would force the camera. Leaving
          it off lets mobile users choose the photo library OR take a
          new photo. */}
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPhotoChange}
      />
    </div>
  );
}

// --- Helpers ---------------------------------------------------------------

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

const pad = (n: number) => n.toString().padStart(2, "0");

function toLocalInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
