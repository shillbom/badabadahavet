import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  MapPin,
  Crosshair,
  CalendarDays,
  Camera,
  X,
  ArrowLeft,
  Sparkles,
  Search,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useStore } from "@/store/sessions";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import SwimMap from "@/components/SwimMap";
import { toast } from "@/components/ui/Toast";
import { celebrate } from "@/components/Celebration";
import {
  createSession,
  findOrCreatePlace,
  updateUserLastLocation,
} from "@/lib/data";
import { reverseGeocodeCountry } from "@/lib/geocode";
import { haversineMeters } from "@/lib/utils";
import {
  PLACE_RADIUS_METERS,
  isWinterMonth,
  previewPoints,
} from "@/lib/scoring";
import { resolveBorder } from "@/lib/borders";
import type { SessionDoc } from "@/lib/types";
import { useLocale, useT } from "@/lib/i18n";

type Mode = "now" | "pick";

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
  const places = useStore((s) => s.places);
  const allSessions = useStore((s) => s.allSessions);
  const myPlaceIds = useStore((s) => s.myPlaceIds);
  const unlockedAchievements = useStore((s) => s.unlockedAchievements);

  // Pre-select a place when navigating from SpotPage (?placeId=xxx).
  const preselectedPlaceId = searchParams.get("placeId");
  const preselectedPlace = preselectedPlaceId
    ? (places.find((p) => p.id === preselectedPlaceId) ?? null)
    : null;

  const [mode, setMode] = useState<Mode>(preselectedPlaceId ? "pick" : "now");
  const [name, setName] = useState(preselectedPlace?.name ?? "");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => toLocalInput(new Date()));
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    preselectedPlace
      ? { lat: preselectedPlace.lat, lng: preselectedPlace.lng }
      : null,
  );
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState<string | null>(null);
  const [pickedPlaceId, setPickedPlaceId] = useState<string | null>(
    preselectedPlaceId,
  );
  const [searchOrigin, setSearchOrigin] = useState<{
    lat: number;
    lng: number;
  } | null>(profile?.lastLocation ?? { lat: 57.3298, lng: 12.1393 });
  const photoInput = useRef<HTMLInputElement>(null);
  const swimMapRef = useRef<import("leaflet").Map | null>(null);
  const hasFlownToUserRef = useRef(false);
  // Tracks whether we've already done the "auto-attach to nearest place"
  // check for the current "now" mode entry. Reset each time the user
  // re-enters now mode so we run once per session.
  const autoPickedNowRef = useRef(false);
  // Set when the user explicitly clicks the "now" tab — suppresses the
  // auto-fallback to "pick" mode when no nearby place is found so the
  // user's intentional choice is respected.
  const intentionalNowRef = useRef(false);

  // Geolocate once just for sorting search results by distance — works
  // even in "pick" mode where coords aren't auto-set from geolocation.
  // Initialised above with a fallback; here we override with the real position.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setSearchOrigin(loc);
        if (user) void updateUserLastLocation(user.uid, loc.lat, loc.lng);
      },
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
  }, []);

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
      setCountry(null);
      return;
    }
    const ctrl = new AbortController();
    reverseGeocodeCountry(coords.lat, coords.lng, ctrl.signal).then((c) => {
      if (!ctrl.signal.aborted) setCountry(c);
    });
    return () => ctrl.abort();
  }, [coords]);

  // When entering "now" mode, auto-attach to the nearest existing place
  // within 200 m. Runs once per now-mode entry so the user can clear the
  // lock without it snapping back. If nothing is nearby, auto-switches to
  // "pick" mode so the user can place a pin manually.
  useEffect(() => {
    if (mode !== "now") return;
    if (!coords) return;
    if (autoPickedNowRef.current) return;
    if (pickedPlaceId) return;
    autoPickedNowRef.current = true;
    let best: { p: (typeof places)[number]; dist: number } | null = null;
    for (const p of places) {
      const d = haversineMeters(coords, p);
      if (d <= 200 && (!best || d < best.dist)) best = { p, dist: d };
    }
    if (best) {
      setCoords({ lat: best.p.lat, lng: best.p.lng });
      setName(best.p.name);
      setPickedPlaceId(best.p.id);
    } else if (places.length > 0 && !intentionalNowRef.current) {
      // Nothing within 200 m — switch to pick-on-map so the user can
      // drop a pin at their actual location. Skip when the user explicitly
      // chose "now" mode so their intentional choice is respected.
      setMode("pick");
    }
  }, [mode, coords, places, pickedPlaceId]);

  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(id);
  }, [search]);

  // Pre-compute lowercased names once when places change — avoids calling
  // .toLowerCase() on every place for every search keystroke.
  const placesWithKey = useMemo(
    () => places.map((p) => ({ p, key: p.name.toLowerCase() })),
    [places],
  );

  const searchMatches = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return [];
    const origin = coords ?? searchOrigin;
    const matches = placesWithKey
      .filter(({ key }) => key.includes(q))
      .map(({ p }) => p);
    if (origin) {
      matches.sort(
        (a, b) => haversineMeters(origin, a) - haversineMeters(origin, b),
      );
    }
    return matches.slice(0, 5);
  }, [placesWithKey, debouncedSearch, coords, searchOrigin]);

  const suggestion = useMemo(() => {
    if (!coords) return null;
    let best: { name: string; dist: number } | null = null;
    for (const p of places) {
      const d = haversineMeters(coords, p);
      if (d < PLACE_RADIUS_METERS && (!best || d < best.dist))
        best = { name: p.name, dist: d };
    }
    return best?.name ?? null;
  }, [coords, places]);

  useEffect(() => {
    if (mode === "now") {
      setPickedPlaceId(null);
      setName("");
      setSearch("");
      autoPickedNowRef.current = false;
      setDate(toLocalInput(new Date()));
      if (!navigator.geolocation) {
        toast.error(t("log.geo.unavailable"));
        setMode("pick");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {
          toast.error(t("log.geo.failed"));
          setMode("pick");
        },
        { enableHighAccuracy: true, timeout: 8000 },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function onPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhotoFile(f);
    setPhotoPreview(URL.createObjectURL(f));
  }

  function clearPhoto() {
    setPhotoFile(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    if (photoInput.current) photoInput.current.value = "";
  }

  async function submit(e: React.FormEvent) {
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
      const place = await findOrCreatePlace({
        name: finalName,
        lat: coords.lat,
        lng: coords.lng,
        createdBy: user.uid,
        date: ts,
      });
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
        photoFile,
        country,
        border: myBorder.id,
      });
      celebrate.swim(session.points, session.isUniqueForUser, session.isWinter);
      navigate("/history");
    } catch {
      toast.error(t("log.error.generic"));
    } finally {
      setBusy(false);
    }
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
  const sessionsByPlace = useMemo(() => {
    const m = new Map<string, SessionDoc[]>();
    for (const s of allSessions) {
      const arr = m.get(s.placeId) ?? [];
      arr.push(s);
      m.set(s.placeId, arr);
    }
    return m;
  }, [allSessions]);

  return (
    <form onSubmit={submit} className="px-4 pt-2 pb-10">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="rounded-full bg-white/70 p-2 ring-1 ring-slate-200"
          aria-label={t("common.back")}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="font-display text-xl font-black text-wave-900">
          {t("log.title")}
        </h2>
        <span className="w-8" />
      </div>

      <div className="flex rounded-full bg-slate-100 p-1">
        <button
          type="button"
          data-active={mode === "now"}
          onClick={() => {
            intentionalNowRef.current = true;
            setMode("now");
          }}
          className="pill-tab"
        >
          <Crosshair className="h-3.5 w-3.5" /> {t("log.mode.now")}
        </button>
        <button
          type="button"
          data-active={mode === "pick"}
          onClick={() => {
            intentionalNowRef.current = false;
            setMode("pick");
          }}
          className="pill-tab"
        >
          <CalendarDays className="h-3.5 w-3.5" /> {t("log.mode.pick")}
        </button>
      </div>

      <p className="mt-2 px-1 text-center text-[11px] text-slate-500">
        {mode === "now" ? t("log.mode.now.hint") : t("log.mode.pick.hint")}
      </p>

      <AnimatePresence mode="wait">
        <motion.div
          key={mode}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className="mt-4 space-y-4"
        >
          {mode === "pick" ? (
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder={t("log.search.placeholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
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
                            setCoords({ lat: p.lat, lng: p.lng });
                            setName(p.name);
                            setPickedPlaceId(p.id);
                            setSearch("");
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
          ) : null}

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
                          if (
                            d <= PLACE_RADIUS_METERS &&
                            (!snap || d < snap.dist)
                          ) {
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
                          setCoords({ lat: snap.lat, lng: snap.lng });
                          setName(snap.name);
                          setPickedPlaceId(snap.id);
                        } else {
                          setCoords({ lat, lng });
                          setName("");
                          setPickedPlaceId(null);
                        }
                      }
                    : undefined
                }
                onPickExisting={(p) => {
                  setCoords({ lat: p.lat, lng: p.lng });
                  setName(p.name);
                  setPickedPlaceId(p.id);
                  swimMapRef.current?.flyTo([p.lat, p.lng], 14, {
                    duration: 0.8,
                  });
                }}
                pickedAt={coords}
                linkToSpot={false}
                activePlaceId={pickedPlaceId}
                lockPan={mode === "now"}
                keepCenteredOn={
                  mode === "now" ? (searchOrigin ?? coords) : null
                }
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
                </span>
              ) : mode === "now" ? (
                <span>{t("log.coords.reading")}</span>
              ) : (
                <span>{t("log.empty.pick")}</span>
              )}
            </div>
          </div>

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
                onChange={(e) => setName(e.target.value)}
                disabled={!!pickedPlaceId}
                readOnly={!!pickedPlaceId}
                className={pickedPlaceId ? "bg-slate-100 pr-9" : undefined}
              />
              {pickedPlaceId ? (
                <button
                  type="button"
                  onClick={() => {
                    setPickedPlaceId(null);
                    setName("");
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

          <div className="space-y-1.5">
            <Label htmlFor="date">{t("log.field.when")}</Label>
            <Input
              id="date"
              type="datetime-local"
              lang={inputLang}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={mode === "now"}
              readOnly={mode === "now"}
              className={
                mode === "now" ? "bg-slate-100 text-slate-500" : undefined
              }
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

          <div className="space-y-1.5">
            <Label>{t("log.field.photo")}</Label>
            {photoPreview ? (
              <div className="relative overflow-hidden rounded-xl">
                <img
                  src={photoPreview}
                  alt=""
                  className="h-44 w-full object-cover"
                />
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

          <Button type="submit" loading={busy} size="lg" className="w-full">
            {t("log.save")} <Sparkles className="h-4 w-4" />
          </Button>
        </motion.div>
      </AnimatePresence>
    </form>
  );
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

function toLocalInput(d: Date) {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
