import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L, { type LatLngExpression } from "leaflet";
import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { LocateFixed } from "lucide-react";
import { MAP_THEMES } from "@/lib/mapThemes";
import type { PlaceDoc, SessionDoc } from "@/lib/types";
import { formatDate, cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

// Fix default marker icon paths for bundlers (Leaflet's default icons are broken under Vite).
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })
  ._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const dropletIcon = L.divIcon({
  className: "swim-pin",
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  popupAnchor: [0, -24],
  html: `<div style="
    transform: translateY(-4px);
    width: 28px; height: 28px;
    border-radius: 14px 14px 14px 2px;
    background: linear-gradient(135deg,#019eea,#065684);
    box-shadow: 0 4px 12px rgba(2,100,160,0.45);
    border: 2px solid white;
    transform-origin: bottom left;
    transform: rotate(-45deg) translateY(-4px);
  "></div>`,
});

const activePlaceIcon = L.divIcon({
  className: "swim-pin-active",
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -28],
  html: `<div style="
    transform: translateY(-4px);
    width: 32px; height: 32px;
    border-radius: 16px 16px 16px 2px;
    background: linear-gradient(135deg,#fbbf24,#f97316);
    box-shadow: 0 4px 14px rgba(249,115,22,0.55);
    border: 3px solid white;
    transform-origin: bottom left;
    transform: rotate(-45deg) translateY(-4px);
  "></div>`,
});

const newSwimIcon = L.divIcon({
  className: "swim-pin-new",
  iconSize: [34, 44],
  iconAnchor: [17, 40],
  popupAnchor: [0, -36],
  html: `<div style="
    position: relative; width: 34px; height: 44px;
  ">
    <div style="
      position: absolute; left: 50%; top: 0; transform: translateX(-50%);
      width: 30px; height: 30px; border-radius: 50%;
      background: linear-gradient(135deg,#fbbf24,#f97316);
      border: 3px solid white;
      box-shadow: 0 4px 14px rgba(249,115,22,0.55);
      display: flex; align-items: center; justify-content: center;
      color: white; font-weight: 900; font-size: 18px; line-height: 1;
    ">+</div>
    <div style="
      position: absolute; left: 50%; bottom: 0; transform: translateX(-50%);
      width: 0; height: 0;
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-top: 14px solid #f97316;
      filter: drop-shadow(0 2px 4px rgba(249,115,22,0.4));
    "></div>
  </div>`,
});

export type SwimMapProps = {
  places: PlaceDoc[];
  sessionsByPlace: Map<string, SessionDoc[]>;
  center?: LatLngExpression;
  zoom?: number;
  onPick?: (lat: number, lng: number) => void;
  pickedAt?: { lat: number; lng: number } | null;
  className?: string;
  linkToSpot?: boolean;
  userLocation?: { lat: number; lng: number } | null;
  /** Bumping this triggers a re-fit to all places. */
  fitToken?: number;
  /** When set, clicking an existing place pin offers a "use this spot" action. */
  onPickExisting?: (place: PlaceDoc) => void;
  /** Highlight one place's pin with an "active" icon — used when the
   *  user has picked an existing place. The standalone new-swim pin is
   *  then suppressed so we don't double up. */
  activePlaceId?: string | null;
  /** Disables panning while still allowing zoom (for "now" mode). */
  lockPan?: boolean;
  /** When set, the map re-centers on this point after every zoom so a
   *  zoomed-in user can't drift away from their current position. */
  keepCenteredOn?: { lat: number; lng: number } | null;
  /** Filter which existing places offer the "Use this spot" affordance.
   *  Defaults to all places when `onPickExisting` is set. */
  canPickExisting?: (place: PlaceDoc) => boolean;
};

const userLocationIcon = L.divIcon({
  className: "swim-me",
  iconSize: [18, 18],
  iconAnchor: [9, 9],
  html: `<div style="
    position: relative; width: 18px; height: 18px;
  ">
    <div style="
      position: absolute; inset: 0; border-radius: 50%;
      background: #2563eb; border: 3px solid white;
      box-shadow: 0 0 0 2px rgba(37,99,235,0.35), 0 4px 10px rgba(37,99,235,0.4);
    "></div>
  </div>`,
});

export default function SwimMap({
  places,
  sessionsByPlace,
  center,
  zoom = 5,
  onPick,
  pickedAt,
  className,
  linkToSpot = true,
  userLocation,
  fitToken,
  onPickExisting,
  activePlaceId,
  lockPan,
  keepCenteredOn,
  canPickExisting,
}: SwimMapProps) {
  const t = useT();
  // Theme picker is currently disabled — the calm "Soft" (Voyager) tiles
  // are the only style. The picker UI below is left commented out so we
  // can flip it back on easily later.
  const theme = MAP_THEMES[0];
  const fallbackCenter: LatLngExpression = useMemo(() => {
    if (userLocation) return [userLocation.lat, userLocation.lng];
    if (places.length) return [places[0].lat, places[0].lng];
    return [59.32, 18.06]; // Stockholm — a wholesome default for swim spots
  }, [places, userLocation]);
  const fallbackZoom = userLocation && places.length === 0 ? 12 : zoom;
  const mapRef = useRef<L.Map | null>(null);

  return (
    <div
      className={cn("relative h-full w-full", className)}
    >
      <MapContainer
        center={center ?? fallbackCenter}
        zoom={fallbackZoom}
        scrollWheelZoom
        dragging={!lockPan}
        doubleClickZoom
        touchZoom
        boxZoom={!lockPan}
        keyboard={!lockPan}
        className="h-full w-full rounded-2xl"
        ref={(m) => {
          mapRef.current = m;
        }}
      >
        <TileLayer
          key={theme.id}
          attribution={theme.attribution}
          url={theme.url}
          subdomains={theme.subdomains ?? "abc"}
          maxZoom={theme.maxZoom ?? 19}
        />
        <FitToPlaces
          places={places}
          userLocation={userLocation ?? null}
          fitToken={fitToken}
        />
        {keepCenteredOn ? <KeepCentered target={keepCenteredOn} /> : null}
        {userLocation ? (
          <Marker
            position={[userLocation.lat, userLocation.lng]}
            icon={userLocationIcon}
          />
        ) : null}
        {places.map((p) => {
          const isActive = activePlaceId === p.id;
          const sessions = sessionsByPlace.get(p.id) ?? [];
          const photos = sessions
            .filter((s) => s.photoUrl)
            .slice(0, 6);
          return (
            <Marker
              key={p.id}
              position={[p.lat, p.lng]}
              icon={isActive ? activePlaceIcon : dropletIcon}
            >
              <Popup>
                <div className="text-sm">
                  <div className="font-semibold text-wave-900">{p.name}</div>
                  <div className="text-[11px] text-slate-500">
                    {sessions.length === 1
                      ? t("map.popup.swims_one")
                      : t("map.popup.swims_many", { n: sessions.length })}
                  </div>
                  {photos.length ? (
                    <div className="mt-1.5 flex gap-1 overflow-x-auto">
                      {photos.map((s) => (
                        <img
                          key={s.id}
                          src={s.photoUrl}
                          alt=""
                          loading="lazy"
                          className="h-12 w-12 flex-none rounded-md object-cover ring-1 ring-slate-200"
                        />
                      ))}
                    </div>
                  ) : null}
                  <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                    {sessions.slice(0, 5).map((s) => (
                      <li key={s.id} className="text-[11px]">
                        {formatDate(s.date)} — {s.displayName}
                        {s.isWinter ? " ❄️" : ""}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {onPickExisting && (!canPickExisting || canPickExisting(p)) ? (
                      <button
                        type="button"
                        onClick={() => {
                          mapRef.current?.closePopup();
                          onPickExisting(p);
                        }}
                        className="rounded-full bg-wave-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-wave-700"
                      >
                        {t("map.popup.use_this_spot")}
                      </button>
                    ) : null}
                    {linkToSpot ? (
                      <Link
                        to={`/spot/${p.id}`}
                        className="text-[11px] font-semibold text-wave-700 hover:underline"
                      >
                        {t("map.popup.see_full_history")}
                      </Link>
                    ) : null}
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
        {pickedAt && !activePlaceId ? (
          <Marker position={[pickedAt.lat, pickedAt.lng]} icon={newSwimIcon} />
        ) : null}
        {onPick ? <ClickToPick onPick={onPick} /> : null}
      </MapContainer>
      {userLocation ? (
        <button
          type="button"
          onClick={() => {
            const map = mapRef.current;
            if (map) map.setView([userLocation.lat, userLocation.lng], 13, { animate: true });
          }}
          className="absolute right-3 top-3 z-[600] flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-wave-700 shadow-md ring-1 ring-slate-200 transition active:scale-95 hover:bg-white"
          aria-label={t("map.center_on_me")}
          title={t("map.center_on_me")}
        >
          <LocateFixed className="h-5 w-5" />
        </button>
      ) : null}

      {/* Theme picker — kept as a comment in case we want it back. */}
      {/*
      <div className="absolute right-3 top-14 z-[600]">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-wave-700 shadow-md ring-1 ring-slate-200"
          aria-label={t("map.theme")}
        >
          <Palette className="h-5 w-5" />
        </button>
        {pickerOpen ? (
          <div className="absolute right-12 top-0 flex flex-col gap-1 rounded-xl bg-white/95 p-1.5 shadow-md ring-1 ring-slate-200">
            {MAP_THEMES.map((th) => (
              <button
                key={th.id}
                type="button"
                onClick={() => { setTheme(th.id); setPickerOpen(false); }}
                className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs font-semibold"
              >
                <span style={{ background: th.swatch }} className="h-5 w-5 rounded-md" />
                {t(`map.theme.${th.id}`)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      */}
    </div>
  );
}

function KeepCentered({
  target,
}: {
  target: { lat: number; lng: number };
}) {
  const map = useMap();
  useEffect(() => {
    const recenter = () => {
      map.setView([target.lat, target.lng], map.getZoom(), { animate: false });
    };
    // Snap back after every zoom so a locked map can't drift away.
    map.on("zoomend", recenter);
    return () => {
      map.off("zoomend", recenter);
    };
  }, [map, target.lat, target.lng]);
  return null;
}

function FitToPlaces({
  places,
  userLocation,
  fitToken,
}: {
  places: PlaceDoc[];
  userLocation: { lat: number; lng: number } | null;
  fitToken?: number;
}) {
  const map = useMap();
  useEffect(() => {
    if (places.length) {
      const pts: [number, number][] = places.map((p) => [p.lat, p.lng]);
      if (userLocation) pts.push([userLocation.lat, userLocation.lng]);
      const bounds = L.latLngBounds(pts);
      map.fitBounds(bounds.pad(0.25), { animate: true, maxZoom: 12 });
    } else if (userLocation) {
      map.setView([userLocation.lat, userLocation.lng], 12, { animate: true });
    }
  }, [places, userLocation, map, fitToken]);
  return null;
}

function ClickToPick({
  onPick,
}: {
  onPick: (lat: number, lng: number) => void;
}) {
  const map = useMap();
  useEffect(() => {
    const handler = (e: L.LeafletMouseEvent) =>
      onPick(e.latlng.lat, e.latlng.lng);
    map.on("click", handler);
    return () => {
      map.off("click", handler);
    };
  }, [map, onPick]);
  return null;
}
