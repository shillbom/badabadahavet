import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import L, { type LatLngExpression } from "leaflet";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import MarkerClusterGroup from "react-leaflet-cluster";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Link } from "react-router-dom";
import { Layers, LocateFixed } from "lucide-react";
import { MAP_THEMES } from "@/lib/mapThemes";
import { maybeRefreshPlaceTemp } from "@/lib/refreshTemp";
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

// All pins share the same shape: a coloured circle with a small
// triangle tail. The tail's tip sits at the bottom-center of the icon
// box (iconAnchor = [w/2, h]) so it always lands exactly on the
// lat/lng — no off-by-anchor rotation tricks.
function pinHtml(opts: {
  size: number;
  bg: string;
  tail: string;
  shadow: string;
  border: number;
  content?: string;
  tailHeight?: number;
}): string {
  const tailH = opts.tailHeight ?? 12;
  const total = opts.size + tailH;
  return `<div style="position:relative;width:${opts.size}px;height:${total}px;">
    <div style="
      position:absolute;left:0;top:0;
      width:${opts.size}px;height:${opts.size}px;
      border-radius:50%;
      background:${opts.bg};
      border:${opts.border}px solid white;
      box-shadow:0 4px 12px ${opts.shadow};
      display:flex;align-items:center;justify-content:center;
      color:white;font-weight:900;font-size:${Math.round(opts.size * 0.55)}px;line-height:1;
    ">${opts.content ?? ""}</div>
    <div style="
      position:absolute;left:50%;bottom:0;transform:translateX(-50%);
      width:0;height:0;
      border-left:${Math.round(tailH * 0.45)}px solid transparent;
      border-right:${Math.round(tailH * 0.45)}px solid transparent;
      border-top:${tailH}px solid ${opts.tail};
      filter:drop-shadow(0 2px 3px ${opts.shadow});
    "></div>
  </div>`;
}

const PIN_SIZE = 28;
const PIN_TAIL = 12;
const PIN_TOTAL = PIN_SIZE + PIN_TAIL;

const dropletIcon = L.divIcon({
  className: "swim-pin",
  iconSize: [PIN_SIZE, PIN_TOTAL],
  iconAnchor: [PIN_SIZE / 2, PIN_TOTAL],
  popupAnchor: [0, -PIN_SIZE],
  html: pinHtml({
    size: PIN_SIZE,
    bg: "linear-gradient(135deg,#019eea,#065684)",
    tail: "#065684",
    shadow: "rgba(2,100,160,0.45)",
    border: 2,
  }),
});

// Cache temp-labelled pins keyed by integer °C so we don't rebuild
// the icon for every marker on every render.
const tempIconCache = new Map<number, L.DivIcon>();

function tempIcon(temp: number): L.DivIcon {
  const rounded = Math.round(temp);
  const cached = tempIconCache.get(rounded);
  if (cached) return cached;
  const icon = L.divIcon({
    className: "swim-pin-temp",
    iconSize: [PIN_SIZE, PIN_TOTAL],
    iconAnchor: [PIN_SIZE / 2, PIN_TOTAL],
    popupAnchor: [0, -PIN_SIZE],
    html: pinHtml({
      size: PIN_SIZE,
      bg: "linear-gradient(135deg,#0284c7,#075985)",
      tail: "#075985",
      shadow: "rgba(2,100,160,0.45)",
      border: 2,
      content: `<span style="font-size:11px;line-height:1;">${rounded}°</span>`,
    }),
  });
  tempIconCache.set(rounded, icon);
  return icon;
}

const ACTIVE_SIZE = 32;
const ACTIVE_TAIL = 14;
const ACTIVE_TOTAL = ACTIVE_SIZE + ACTIVE_TAIL;

const activePlaceIcon = L.divIcon({
  className: "swim-pin-active",
  iconSize: [ACTIVE_SIZE, ACTIVE_TOTAL],
  iconAnchor: [ACTIVE_SIZE / 2, ACTIVE_TOTAL],
  popupAnchor: [0, -ACTIVE_SIZE],
  html: pinHtml({
    size: ACTIVE_SIZE,
    bg: "linear-gradient(135deg,#fbbf24,#f97316)",
    tail: "#f97316",
    shadow: "rgba(249,115,22,0.55)",
    border: 3,
    tailHeight: ACTIVE_TAIL,
  }),
});

const newSwimIcon = L.divIcon({
  className: "swim-pin-new",
  iconSize: [ACTIVE_SIZE, ACTIVE_TOTAL],
  iconAnchor: [ACTIVE_SIZE / 2, ACTIVE_TOTAL],
  popupAnchor: [0, -ACTIVE_SIZE],
  html: pinHtml({
    size: ACTIVE_SIZE,
    bg: "linear-gradient(135deg,#fbbf24,#f97316)",
    tail: "#f97316",
    shadow: "rgba(249,115,22,0.55)",
    border: 3,
    content: "+",
    tailHeight: ACTIVE_TAIL,
  }),
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
  /** When true, suppresses the initial auto-fit-to-all-places so the
   *  map stays on the explicitly provided center/zoom. */
  skipInitialFit?: boolean;
  /** When true, fitBounds to the supplied places on load / fitToken bump.
   *  When false (default), the map centres on userLocation at a preset zoom
   *  instead of zooming out to fit all places. */
  fitBoundsToPlaces?: boolean;
  /** Optional ref that will be populated with the Leaflet Map instance,
   *  allowing the parent to call flyTo / setView imperatively. */
  mapRef?: RefObject<L.Map | null>;
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

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Returns true only when a place has a numeric temp that is ≤ 7 days old. */
function hasFreshTemp(
  p: PlaceDoc,
): p is PlaceDoc & { waterTemp: number; waterTempAt: number } {
  if (typeof p.waterTemp !== "number") return false;
  if (!p.waterTempAt) return false;
  return Date.now() - p.waterTempAt <= WEEK_MS;
}

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
  skipInitialFit,
  fitBoundsToPlaces = false,
  mapRef: externalMapRef,
}: SwimMapProps) {
  const t = useT();
  const [satellite, setSatellite] = useState(false);
  const baseTheme = MAP_THEMES[0];
  const satelliteTheme = MAP_THEMES.find((t) => t.id === "satellite")!;
  const theme = satellite ? satelliteTheme : baseTheme;
  const fallbackCenter: LatLngExpression = useMemo(() => {
    if (userLocation) return [userLocation.lat, userLocation.lng];
    if (places.length) return [places[0].lat, places[0].lng];
    return [59.32, 18.06]; // Stockholm — a wholesome default for swim spots
  }, [places, userLocation]);
  const fallbackZoom = userLocation && places.length === 0 ? 12 : zoom;
  const mapRef = useRef<L.Map | null>(null);

  return (
    <div className={cn("relative h-full w-full", className)}>
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
          if (externalMapRef)
            (externalMapRef as React.MutableRefObject<L.Map | null>).current =
              m;
        }}
      >
        <TileLayer
          key={theme.id}
          attribution={theme.attribution}
          url={theme.url}
          subdomains={theme.subdomains ?? "abc"}
          maxZoom={theme.maxZoom ?? 19}
        />
        {/* Transparent labels overlay on top of satellite imagery */}
        {satellite && (
          <TileLayer
            key="satellite-labels"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
            attribution=""
            maxZoom={20}
            opacity={1}
          />
        )}
        <MapZoomLock locked={!!lockPan} />
        <FitToPlaces
          places={places}
          userLocation={userLocation ?? null}
          fitToken={fitToken}
          skipInitialFit={skipInitialFit}
          fitBoundsToPlaces={fitBoundsToPlaces}
        />
        {keepCenteredOn ? <KeepCentered target={keepCenteredOn} /> : null}
        {userLocation ? (
          <Marker
            position={[userLocation.lat, userLocation.lng]}
            icon={userLocationIcon}
          />
        ) : null}
        <MarkerClusterGroup
          chunkedLoading
          maxClusterRadius={50}
          showCoverageOnHover={false}
          spiderfyOnMaxZoom
        >
          {places
            .filter((p) => p.id !== activePlaceId)
            .map((p) => {
              const sessions = sessionsByPlace.get(p.id) ?? [];
              const photos = sessions.filter((s) => s.photoUrl).slice(0, 6);
              // When logging a swim, clicking a pickable pin selects it
              // immediately — no popup button needed.
              const isPickable =
                !!onPickExisting && (!canPickExisting || canPickExisting(p));

              return (
                <Marker
                  key={p.id}
                  position={[p.lat, p.lng]}
                  icon={hasFreshTemp(p) ? tempIcon(p.waterTemp) : dropletIcon}
                  eventHandlers={{
                    mouseover: () => maybeRefreshPlaceTemp(p),
                    click: () => {
                      maybeRefreshPlaceTemp(p);
                      if (isPickable) {
                        mapRef.current?.closePopup();
                        onPickExisting(p);
                      }
                    },
                  }}
                >
                  {hasFreshTemp(p) ? (
                    <Tooltip direction="top" offset={[0, -PIN_TOTAL + 4]}>
                      <div className="text-[11px]">
                        <span className="font-semibold text-wave-900">
                          💧 {p.waterTemp.toFixed(1)} °C
                        </span>
                        {p.waterTempAt ? (
                          <span className="ml-1 text-slate-500">
                            · {formatAge(p.waterTempAt, t)}
                          </span>
                        ) : null}
                      </div>
                    </Tooltip>
                  ) : null}
                  {/* Only show popup when not in logging mode — clicking a
                    pin while logging selects it immediately instead. */}
                  {!isPickable ? (
                    <Popup>
                      <div className="text-sm">
                        <div className="font-semibold text-wave-900">
                          {p.name}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {sessions.length === 1
                            ? t("map.popup.swims_one")
                            : sessions.length > 0
                              ? t("map.popup.swims_many", {
                                  n: sessions.length,
                                })
                              : t("map.popup.no_swims_yet")}
                        </div>
                        {hasFreshTemp(p) ? (
                          <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800 ring-1 ring-sky-200">
                            💧 {p.waterTemp.toFixed(1)} °C
                            {p.waterTempAt ? (
                              <span className="font-normal text-sky-600">
                                · {formatAge(p.waterTempAt, t)}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
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
                        {linkToSpot ? (
                          <div className="mt-1.5">
                            <Link
                              to={`/spot/${p.id}`}
                              className="text-[11px] font-semibold text-wave-700 hover:underline"
                            >
                              {t("map.popup.see_full_history")}
                            </Link>
                          </div>
                        ) : null}
                      </div>
                    </Popup>
                  ) : null}
                </Marker>
              );
            })}
        </MarkerClusterGroup>
        {/* Active place is rendered outside the cluster group so it is never
            merged into a cluster bubble regardless of zoom level. */}
        {activePlaceId
          ? places
              .filter((p) => p.id === activePlaceId)
              .map((p) => {
                const sessions = sessionsByPlace.get(p.id) ?? [];
                const photos = sessions.filter((s) => s.photoUrl).slice(0, 6);
                const isPickable =
                  !!onPickExisting && (!canPickExisting || canPickExisting(p));
                return (
                  <Marker
                    key={`active-${p.id}`}
                    position={[p.lat, p.lng]}
                    icon={activePlaceIcon}
                    eventHandlers={{
                      mouseover: () => maybeRefreshPlaceTemp(p),
                      click: () => {
                        maybeRefreshPlaceTemp(p);
                        if (isPickable) {
                          mapRef.current?.closePopup();
                          onPickExisting(p);
                        }
                      },
                    }}
                  >
                    {hasFreshTemp(p) ? (
                      <Tooltip direction="top" offset={[0, -PIN_TOTAL + 4]}>
                        <div className="text-[11px]">
                          <span className="font-semibold text-wave-900">
                            💧 {p.waterTemp.toFixed(1)} °C
                          </span>
                          {p.waterTempAt ? (
                            <span className="ml-1 text-slate-500">
                              · {formatAge(p.waterTempAt, t)}
                            </span>
                          ) : null}
                        </div>
                      </Tooltip>
                    ) : null}
                    {!isPickable ? (
                      <Popup>
                        <div className="text-sm">
                          <div className="font-semibold text-wave-900">
                            {p.name}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {sessions.length === 1
                              ? t("map.popup.swims_one")
                              : sessions.length > 0
                                ? t("map.popup.swims_many", {
                                    n: sessions.length,
                                  })
                                : t("map.popup.no_swims_yet")}
                          </div>
                          {hasFreshTemp(p) ? (
                            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800 ring-1 ring-sky-200">
                              💧 {p.waterTemp.toFixed(1)} °C
                              {p.waterTempAt ? (
                                <span className="font-normal text-sky-600">
                                  · {formatAge(p.waterTempAt, t)}
                                </span>
                              ) : null}
                            </div>
                          ) : null}
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
                          {linkToSpot ? (
                            <div className="mt-1.5">
                              <Link
                                to={`/spot/${p.id}`}
                                className="text-[11px] font-semibold text-wave-700 hover:underline"
                              >
                                {t("map.popup.see_full_history")}
                              </Link>
                            </div>
                          ) : null}
                        </div>
                      </Popup>
                    ) : null}
                  </Marker>
                );
              })
          : null}
        {pickedAt && !activePlaceId ? (
          <Marker position={[pickedAt.lat, pickedAt.lng]} icon={newSwimIcon} />
        ) : null}
        {onPick ? <ClickToPick onPick={onPick} /> : null}
      </MapContainer>
      {/* Layer toggle — top right, shows what you'll switch TO */}
      <button
        type="button"
        onClick={() => setSatellite((v) => !v)}
        className={cn(
          "absolute top-12 right-3 z-[600] flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold shadow-md ring-1 transition active:scale-95",
          satellite
            ? "bg-white/95 text-wave-800 ring-slate-200 hover:bg-white"
            : "bg-white/95 text-wave-800 ring-slate-200 hover:bg-white",
        )}
        aria-label={
          satellite ? t("map.toggle_terrain") : t("map.toggle_satellite")
        }
      >
        <Layers className="h-3.5 w-3.5" />
        {satellite ? t("map.toggle_terrain") : t("map.toggle_satellite")}
      </button>

      {/* Locate me — bottom right, Google Maps style */}
      {userLocation ? (
        <button
          type="button"
          onClick={() => {
            const map = mapRef.current;
            if (map)
              map.setView([userLocation.lat, userLocation.lng], 13, {
                animate: true,
              });
          }}
          className="absolute right-3 bottom-5 z-[600] flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-wave-700 shadow-md ring-1 ring-slate-200 transition hover:bg-white active:scale-95"
          aria-label={t("map.center_on_me")}
          title={t("map.center_on_me")}
        >
          <LocateFixed className="h-5 w-5" />
        </button>
      ) : null}
    </div>
  );
}

function KeepCentered({ target }: { target: { lat: number; lng: number } }) {
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

/** Disables / re-enables all zoom interactions reactively. */
function MapZoomLock({ locked }: { locked: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (locked) {
      map.scrollWheelZoom.disable();
      map.touchZoom.disable();
      map.doubleClickZoom.disable();
      map.boxZoom.disable();
    } else {
      map.scrollWheelZoom.enable();
      map.touchZoom.enable();
      map.doubleClickZoom.enable();
      map.boxZoom.enable();
    }
  }, [map, locked]);
  return null;
}

function FitToPlaces({
  places,
  userLocation,
  fitToken,
  skipInitialFit,
  fitBoundsToPlaces = false,
}: {
  places: PlaceDoc[];
  userLocation: { lat: number; lng: number } | null;
  fitToken?: number;
  skipInitialFit?: boolean;
  fitBoundsToPlaces?: boolean;
}) {
  const map = useMap();
  const hasInitialFit = useRef(false);
  const lastFitToken = useRef(fitToken);

  useEffect(() => {
    // Only auto-fit on the very first render with usable data, or when
    // fitToken explicitly bumps. Otherwise toggling "show all" would
    // zoom back out to fit hundreds of spots, which is jarring.
    const tokenChanged = fitToken !== lastFitToken.current;
    lastFitToken.current = fitToken;
    if (hasInitialFit.current && !tokenChanged) return;
    if (skipInitialFit && !tokenChanged) {
      hasInitialFit.current = true;
      return;
    }

    if (fitBoundsToPlaces && places.length) {
      const pts: [number, number][] = places.map((p) => [p.lat, p.lng]);
      if (userLocation) pts.push([userLocation.lat, userLocation.lng]);
      const bounds = L.latLngBounds(pts);
      map.fitBounds(bounds.pad(0.25), { animate: true, maxZoom: 13 });
      hasInitialFit.current = true;
    } else if (userLocation) {
      map.setView([userLocation.lat, userLocation.lng], 11, { animate: true });
      hasInitialFit.current = true;
    } else if (places.length) {
      const pts: [number, number][] = places.map((p) => [p.lat, p.lng]);
      const bounds = L.latLngBounds(pts);
      map.fitBounds(bounds.pad(0.25), { animate: true, maxZoom: 12 });
      hasInitialFit.current = true;
    }
  }, [places, userLocation, map, fitToken]);
  return null;
}

function formatAge(
  ts: number,
  t: (k: string, vars?: Record<string, string | number>) => string,
): string {
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return t("map.popup.age.mins", { n: Math.max(0, mins) });
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return t("map.popup.age.hrs", { n: hrs });
  const days = Math.round(hrs / 24);
  return t("map.popup.age.days", { n: days });
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
