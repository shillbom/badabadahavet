import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L, { type LatLngExpression } from "leaflet";
// Leaflet's styles ship with the map, not the app shell — keeping this import
// here (rather than in main.tsx) keeps the 190 KB leaflet chunk and its CSS
// off the first-paint critical path; they load lazily with this component.
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import MarkerClusterGroup from "react-leaflet-cluster";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Link } from "react-router-dom";
import { Layers, LocateFixed } from "lucide-react";
import { MAP_THEMES } from "@/lib/mapThemes";
import Photo from "@/components/Photo";
import { maybeRefreshPlaceTemp } from "@/lib/refreshTemp";
import { pinRingFor } from "@/lib/borders";
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
  /** Optional achievement-rank ring drawn just outside the white border. */
  ring?: { ring: string; glow: string } | null;
}): string {
  const tailH = opts.tailHeight ?? 12;
  const total = opts.size + tailH;
  const ringShadow = opts.ring
    ? `0 0 0 3px ${opts.ring.ring},0 0 9px 1px ${opts.ring.glow},`
    : "";
  return `<div style="position:relative;width:${opts.size}px;height:${total}px;font-family:var(--font-display);">
    <div style="
      position:absolute;left:0;top:0;
      width:${opts.size}px;height:${opts.size}px;
      border-radius:50%;
      background:${opts.bg};
      border:${opts.border}px solid white;
      box-shadow:${ringShadow}0 4px 12px ${opts.shadow};
      display:flex;align-items:center;justify-content:center;
      color:white;font-weight:900;font-size:${Math.round(opts.size * 0.62)}px;line-height:1;
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

// Leaflet's default popup autoPan padding is a razor-thin 5px, so an opened
// popup ends up flush against the map's edge — easy to clip against the
// container (Leaflet itself clips overflow) or against a sheet/header
// overlapping the map. Pad it out so a pin never lands right at the edge.
const POPUP_AUTO_PAN_TOP_LEFT: [number, number] = [24, 56];
const POPUP_AUTO_PAN_BOTTOM_RIGHT: [number, number] = [24, 56];

// Cluster only once at least CLUSTER_ON pins are within the current viewport;
// stop clustering below CLUSTER_OFF. The gap is hysteresis — panning across a
// single threshold would otherwise thrash the cluster group, which has to
// remount to change its radius.
const CLUSTER_ON = 10;
const CLUSTER_OFF = 8;

// ── Recency tint ──────────────────────────────────────────────────────────
// A place's pin fades from full blue (swum within the last week) toward grey
// (no swim for ~two months, or never), so the map reads activity at a glance.
// The white temperature label stays legible across the whole range.
const FRESH_MS = 7 * 24 * 60 * 60 * 1000; // ≤ 1 week → full colour
const STALE_MS = 60 * 24 * 60 * 60 * 1000; // ≥ ~2 months → fully grey

/** 1 = swum recently (full colour) … 0 = long stale / never swum (grey). */
function recencyFactor(lastSwimAt?: number): number {
  if (!lastSwimAt) return 0;
  const age = Date.now() - lastSwimAt;
  if (age <= FRESH_MS) return 1;
  if (age >= STALE_MS) return 0;
  return 1 - (age - FRESH_MS) / (STALE_MS - FRESH_MS);
}

type RGB = [number, number, number];
const GREY_TOP: RGB = [0x6b, 0x72, 0x80]; // grey-500
const GREY_BOTTOM: RGB = [0x37, 0x41, 0x51]; // grey-700
const BLUE_TEMP_TOP: RGB = [0x02, 0x84, 0xc7];
const BLUE_TEMP_BOTTOM: RGB = [0x07, 0x59, 0x85];
const BLUE_PLAIN_TOP: RGB = [0x01, 0x9e, 0xea];
const BLUE_PLAIN_BOTTOM: RGB = [0x06, 0x56, 0x84];

/** Channel-wise blend from grey `a` to blue `b` at freshness `t` (0..1). */
function mix(a: RGB, b: RGB, t: number): string {
  const c = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
  return `rgb(${c(0)},${c(1)},${c(2)})`;
}

/** Pin/cluster gradient + tail colour for a given freshness (0..1). */
function recencyColours(hasTemp: boolean, factor: number) {
  const top = hasTemp ? BLUE_TEMP_TOP : BLUE_PLAIN_TOP;
  const bottom = hasTemp ? BLUE_TEMP_BOTTOM : BLUE_PLAIN_BOTTOM;
  return {
    bg: `linear-gradient(135deg,${mix(GREY_TOP, top, factor)},${mix(GREY_BOTTOM, bottom, factor)})`,
    tail: mix(GREY_BOTTOM, bottom, factor),
  };
}

/** An achievement-rank ring applied to the current user's own pins. */
export type PinRing = { id: string; ring: string; glow: string };

// Cache pins keyed by "<temp-or-plain>|<rankId>" so we don't rebuild an
// icon for every marker on every render.
const pinIconCache = new Map<string, L.DivIcon>();

function pinIcon(
  temp: number | null,
  ring: PinRing | null,
  factor = 1,
): L.DivIcon {
  // Bucket freshness into 9 steps so the icon cache stays bounded (and pins
  // don't churn an icon for every millisecond of age).
  const bucket = Math.round(factor * 8);
  const key = `${temp != null ? Math.round(temp) : "plain"}|${ring?.id ?? "none"}|${bucket}`;
  const cached = pinIconCache.get(key);
  if (cached) return cached;
  const hasTemp = temp != null;
  const { bg, tail } = recencyColours(hasTemp, bucket / 8);
  const icon = L.divIcon({
    className: hasTemp ? "swim-pin-temp" : "swim-pin",
    iconSize: [PIN_SIZE, PIN_TOTAL],
    iconAnchor: [PIN_SIZE / 2, PIN_TOTAL],
    popupAnchor: [0, -PIN_SIZE],
    html: pinHtml({
      size: PIN_SIZE,
      bg,
      tail,
      shadow: "rgba(2,100,160,0.45)",
      border: 2,
      ring,
      content: hasTemp
        ? `<span style="font-size:14px;line-height:1;">${Math.round(temp)}°</span>`
        : undefined,
    }),
  });
  pinIconCache.set(key, icon);
  return icon;
}

// Stable key for a place's position so we can look up its temperature
// from a cluster's child markers (which only expose lat/lng, not the
// original PlaceDoc).
function clusterPosKey(lat: number, lng: number): string {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

// Cluster badge: child count, plus the average of any fresh temps below it.
// `factor` is the freshness of the most-recently-swum child, so a cluster
// greys out only once *all* its places are stale.
function clusterIconHtml(
  count: number,
  avgTemp: number | null,
  factor: number,
): string {
  const size = 40;
  const { bg } = recencyColours(false, factor);
  const tempPill =
    avgTemp != null
      ? `<div style="position:absolute;bottom:-6px;left:50%;transform:translateX(-50%);
           background:#0284c7;color:white;font-size:10px;font-weight:700;line-height:1;
           padding:2px 5px;border-radius:8px;border:1.5px solid white;white-space:nowrap;
           box-shadow:0 1px 3px rgba(2,100,160,0.5);">💧 ${Math.round(avgTemp)}°</div>`
      : "";
  return `<div style="position:relative;width:${size}px;height:${size}px;font-family:var(--font-display);">
    <div style="width:${size}px;height:${size}px;border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      background:${bg};color:white;
      font-weight:700;font-size:18px;border:2px solid white;
      box-shadow:0 3px 8px rgba(2,100,160,0.45);">${count}</div>
    ${tempPill}
  </div>`;
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

/** A button rendered in the map's top-right action stack. The map appends
 *  its own built-in actions (e.g. satellite toggle) after these, so the
 *  buttons end up in a consistent vertical list regardless of how many
 *  the caller passes. */
export type MapAction = {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  ariaLabel?: string;
};

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
  /** Caller-supplied buttons rendered above the built-in map actions
   *  (satellite toggle, etc.). Stacked vertically so the layout stays
   *  consistent regardless of which actions are present. */
  topRightActions?: MapAction[];
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
  /** Stable key used to persist pan/zoom across unmounts (e.g. tab navigation).
   *  Maps with the same key share saved view state. Defaults to "default". */
  viewKey?: string;
  /** Pan/zoom to this place and open its popup when it changes. Pair with
   *  `focusToken` to re-trigger for the same place id. */
  focusPlaceId?: string | null;
  focusToken?: number;
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
  viewKey = "default",
  topRightActions,
  focusPlaceId,
  focusToken,
}: SwimMapProps) {
  const t = useT();
  const [satellite, setSatellite] = useState(false);
  // How many clusterable pins are currently in the viewport (null until the
  // first measurement). Drives whether we cluster at all.
  const [inViewCount, setInViewCount] = useState<number | null>(null);
  const clusteringRef = useRef(false);
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
  // Leaflet marker instances, so a focus request can pan to a place and open
  // its popup. (Focused places render outside the cluster, so no cluster
  // reveal is needed.)
  const markerRefs = useRef(new Map<string, L.Marker>());
  const focusTarget = useMemo(() => {
    if (!focusPlaceId) return null;
    const p = places.find((pl) => pl.id === focusPlaceId);
    return p
      ? { lat: p.lat, lng: p.lng, id: p.id, token: focusToken ?? 0 }
      : null;
  }, [focusPlaceId, focusToken, places]);
  const saved = savedViews.get(viewKey);

  // Position → fresh temperature, so a cluster can average the temps of
  // its child markers. Held in a ref the (stable) cluster icon builder
  // reads, so updating temps doesn't recreate the cluster group.
  const tempByPos = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of places) {
      if (hasFreshTemp(p)) m.set(clusterPosKey(p.lat, p.lng), p.waterTemp);
    }
    return m;
  }, [places]);
  const tempByPosRef = useRef(tempByPos);
  tempByPosRef.current = tempByPos;

  // Position → last-swim timestamp, so a cluster can tint itself by the
  // most-recently-swum place beneath it (same ref trick as temps).
  const lastSwimByPos = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of places) {
      if (typeof p.lastSwimAt === "number")
        m.set(clusterPosKey(p.lat, p.lng), p.lastSwimAt);
    }
    return m;
  }, [places]);
  const lastSwimByPosRef = useRef(lastSwimByPos);
  lastSwimByPosRef.current = lastSwimByPos;

  const createClusterIcon = useCallback(
    (cluster: {
      getAllChildMarkers: () => L.Marker[];
      getChildCount: () => number;
    }) => {
      const lookup = tempByPosRef.current;
      const swimLookup = lastSwimByPosRef.current;
      let sum = 0;
      let n = 0;
      let latestSwim = 0;
      for (const m of cluster.getAllChildMarkers()) {
        const ll = m.getLatLng();
        const posKey = clusterPosKey(ll.lat, ll.lng);
        const temp = lookup.get(posKey);
        if (typeof temp === "number") {
          sum += temp;
          n++;
        }
        const swim = swimLookup.get(posKey);
        if (typeof swim === "number" && swim > latestSwim) latestSwim = swim;
      }
      return L.divIcon({
        html: clusterIconHtml(
          cluster.getChildCount(),
          n ? sum / n : null,
          recencyFactor(latestSwim || undefined),
        ),
        className: "swim-cluster",
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      });
    },
    [],
  );

  // The active (being-picked) and focused places are pulled out of the
  // cluster group so they're always their own visible pin — never swallowed
  // by a cluster bubble. And with only a handful of pins we skip clustering
  // entirely so every place stays individually tappable.
  const unclusteredIds = useMemo(
    () =>
      new Set([activePlaceId, focusPlaceId].filter((id): id is string => !!id)),
    [activePlaceId, focusPlaceId],
  );
  const clusterablePlaces = useMemo(
    () => places.filter((p) => !unclusteredIds.has(p.id)),
    [places, unclusteredIds],
  );
  const unclusteredPlaces = useMemo(
    () => places.filter((p) => unclusteredIds.has(p.id)),
    [places, unclusteredIds],
  );

  // Cluster based on how many pins are actually in view. Before the first
  // measurement, fall back to the total so a busy map starts clustered (no
  // flash of hundreds of individual markers). Hysteresis between the two
  // thresholds keeps the group from remounting as you pan over the edge.
  let shouldCluster: boolean;
  if (inViewCount == null) {
    shouldCluster = clusterablePlaces.length >= CLUSTER_ON;
  } else if (inViewCount >= CLUSTER_ON) {
    shouldCluster = true;
  } else if (inViewCount < CLUSTER_OFF) {
    shouldCluster = false;
  } else {
    shouldCluster = clusteringRef.current;
  }
  clusteringRef.current = shouldCluster;

  return (
    <div className={cn("relative h-full w-full", className)}>
      <MapContainer
        center={saved?.center ?? center ?? fallbackCenter}
        zoom={saved?.zoom ?? fallbackZoom}
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
        <AutoInvalidateSize />
        <MapZoomLock locked={!!lockPan} />
        <SaveView viewKey={viewKey} skip={!!saved} />
        <FitToPlaces
          places={places}
          userLocation={userLocation ?? null}
          fitToken={fitToken}
          skipInitialFit={skipInitialFit || !!saved}
          fitBoundsToPlaces={fitBoundsToPlaces}
        />
        {keepCenteredOn ? <KeepCentered target={keepCenteredOn} /> : null}
        <FocusPlace target={focusTarget} markerRefs={markerRefs} />
        <ViewportPinCount places={clusterablePlaces} onCount={setInViewCount} />
        {userLocation ? (
          <Marker
            position={[userLocation.lat, userLocation.lng]}
            icon={userLocationIcon}
          />
        ) : null}
        <MarkerClusterGroup
          // Remount when clustering toggles on/off — markercluster reads
          // maxClusterRadius once at creation. 0 disables clustering, which
          // we use whenever there are fewer than 10 pins to cluster.
          key={shouldCluster ? "clustered" : "flat"}
          chunkedLoading
          maxClusterRadius={shouldCluster ? 50 : 0}
          showCoverageOnHover={false}
          spiderfyOnMaxZoom
          iconCreateFunction={createClusterIcon}
        >
          {clusterablePlaces.map((p) => {
            const sessions = sessionsByPlace.get(p.id) ?? [];
            const photos = sessions.filter((s) => s.photoUrl).slice(0, 6);
            const lastSession = sessions.length
              ? sessions.reduce((a, b) => (b.date > a.date ? b : a))
              : null;
            // When logging a swim, clicking a pickable pin selects it
            // immediately — no popup button needed.
            const isPickable =
              !!onPickExisting && (!canPickExisting || canPickExisting(p));

            return (
              <Marker
                key={p.id}
                ref={(m) => {
                  if (m) markerRefs.current.set(p.id, m);
                  else markerRefs.current.delete(p.id);
                }}
                position={[p.lat, p.lng]}
                icon={pinIcon(
                  hasFreshTemp(p) ? p.waterTemp : null,
                  pinRingFor(p.lastSwimBorder),
                  recencyFactor(p.lastSwimAt),
                )}
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
                {/* Only show popup when not in logging mode — clicking a
                    pin while logging selects it immediately instead. */}
                {!isPickable ? (
                  <Popup
                    autoPanPaddingTopLeft={POPUP_AUTO_PAN_TOP_LEFT}
                    autoPanPaddingBottomRight={POPUP_AUTO_PAN_BOTTOM_RIGHT}
                  >
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
                            <Photo
                              key={s.id}
                              src={s.photoUrl!}
                              thumb={s.photoThumb}
                              className="h-12 w-12 flex-none rounded-md ring-1 ring-slate-200"
                            />
                          ))}
                        </div>
                      ) : null}
                      {lastSession ? (
                        <div className="mt-1 text-[11px]">
                          {formatDate(lastSession.date)} —{" "}
                          {lastSession.displayName}
                          {lastSession.isWinter ? " ❄️" : ""}
                        </div>
                      ) : null}
                      {linkToSpot ? (
                        <Link
                          to={`/spot/${p.id}`}
                          className="mt-2 flex w-full items-center justify-center gap-1 rounded-full bg-wave-600 px-3 py-1.5 text-[11px] font-semibold !text-white no-underline shadow-sm transition hover:bg-wave-700 hover:!text-white"
                        >
                          {t("map.popup.view_spot")}
                        </Link>
                      ) : null}
                    </div>
                  </Popup>
                ) : null}
              </Marker>
            );
          })}
        </MarkerClusterGroup>
        {/* The active (picked) and focused places render outside the cluster
            group with the orange highlight icon, so they're never merged into
            a cluster bubble regardless of zoom level. */}
        {unclusteredPlaces.map((p) => {
          const sessions = sessionsByPlace.get(p.id) ?? [];
          const photos = sessions.filter((s) => s.photoUrl).slice(0, 6);
          const lastSession = sessions.length
            ? sessions.reduce((a, b) => (b.date > a.date ? b : a))
            : null;
          const isPickable =
            !!onPickExisting && (!canPickExisting || canPickExisting(p));
          return (
            <Marker
              key={`active-${p.id}`}
              ref={(m) => {
                if (m) markerRefs.current.set(p.id, m);
                else markerRefs.current.delete(p.id);
              }}
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
              {!isPickable ? (
                <Popup
                  autoPanPaddingTopLeft={POPUP_AUTO_PAN_TOP_LEFT}
                  autoPanPaddingBottomRight={POPUP_AUTO_PAN_BOTTOM_RIGHT}
                >
                  <div className="text-sm">
                    <div className="font-semibold text-wave-900">{p.name}</div>
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
                          <Photo
                            key={s.id}
                            src={s.photoUrl!}
                            thumb={s.photoThumb}
                            className="h-12 w-12 flex-none rounded-md ring-1 ring-slate-200"
                          />
                        ))}
                      </div>
                    ) : null}
                    {lastSession ? (
                      <div className="mt-1 text-[11px]">
                        {formatDate(lastSession.date)} —{" "}
                        {lastSession.displayName}
                        {lastSession.isWinter ? " ❄️" : ""}
                      </div>
                    ) : null}
                    {linkToSpot ? (
                      <Link
                        to={`/spot/${p.id}`}
                        className="mt-2 flex w-full items-center justify-center gap-1 rounded-full bg-wave-600 px-3 py-1.5 text-[11px] font-semibold !text-white no-underline shadow-sm transition hover:bg-wave-700 hover:!text-white"
                      >
                        {t("map.popup.view_spot")}
                      </Link>
                    ) : null}
                  </div>
                </Popup>
              ) : null}
            </Marker>
          );
        })}
        {pickedAt && !activePlaceId ? (
          <Marker position={[pickedAt.lat, pickedAt.lng]} icon={newSwimIcon} />
        ) : null}
        {onPick ? <ClickToPick onPick={onPick} /> : null}
      </MapContainer>
      {/* Stacked action buttons — caller-supplied actions on top, the
          built-in satellite toggle at the bottom of the stack. */}
      <div className="absolute top-3 right-3 z-[600] flex flex-col items-end gap-2">
        {topRightActions?.map((a, i) => (
          <MapActionButton key={i} action={a} />
        ))}
        <MapActionButton
          action={{
            label: satellite
              ? t("map.toggle_terrain")
              : t("map.toggle_satellite"),
            onClick: () => setSatellite((v) => !v),
            icon: <Layers className="h-3.5 w-3.5" />,
          }}
        />
      </div>

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

function MapActionButton({ action }: { action: MapAction }) {
  return (
    <button
      type="button"
      onClick={action.onClick}
      aria-label={action.ariaLabel ?? action.label}
      className="flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-wave-800 shadow-md ring-1 ring-slate-200 transition hover:bg-white active:scale-95"
    >
      {action.icon}
      {action.label}
    </button>
  );
}

/**
 * Pans to a place when `target` changes and opens its popup. The focused
 * place always renders outside the cluster group, so it's a plain
 * flyTo + openPopup; a short delay lets a freshly-mounted marker register.
 */
function FocusPlace({
  target,
  markerRefs,
}: {
  target: { lat: number; lng: number; id: string; token: number } | null;
  markerRefs: RefObject<Map<string, L.Marker>>;
}) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    let moveHandler: (() => void) | null = null;
    const timer = window.setTimeout(() => {
      map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 13), {
        animate: true,
      });
      moveHandler = () => {
        if (moveHandler) map.off("moveend", moveHandler);
        markerRefs.current.get(target.id)?.openPopup();
      };
      map.on("moveend", moveHandler);
    }, 150);
    return () => {
      window.clearTimeout(timer);
      if (moveHandler) map.off("moveend", moveHandler);
    };
  }, [map, target, markerRefs]);
  return null;
}

/**
 * Reports how many of `places` fall within the current viewport, on mount and
 * after every pan/zoom. Lets the map decide whether clustering is worthwhile
 * for what's actually on screen. `onCount` must be referentially stable.
 */
function ViewportPinCount({
  places,
  onCount,
}: {
  places: PlaceDoc[];
  onCount: (n: number) => void;
}) {
  const map = useMap();
  useEffect(() => {
    const measure = () => {
      const bounds = map.getBounds();
      let n = 0;
      for (const p of places) if (bounds.contains([p.lat, p.lng])) n++;
      onCount(n);
    };
    measure();
    map.on("moveend zoomend", measure);
    return () => {
      map.off("moveend zoomend", measure);
    };
  }, [map, places, onCount]);
  return null;
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

/**
 * Keeps Leaflet's cached viewport size in sync with the actual container.
 *
 * Leaflet measures the container once at init and caches it. When a map is
 * created inside something that sizes up *after* mount — a sliding sheet, a
 * tab that was display:none, an orientation change — that cached size is
 * stale, and every fitBounds/setView is computed against the wrong viewport
 * (the classic "map doesn't fit the pins" / grey-tile state). A
 * ResizeObserver re-running invalidateSize() on every container resize fixes
 * the whole class of bugs; invalidateSize keeps the centre, so it never
 * fights a user's manual pan.
 */
function AutoInvalidateSize() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    let raf = 0;
    const invalidate = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => map.invalidateSize({ animate: false }));
    };
    invalidate(); // catch a wrong size from the very first layout pass
    const ro = new ResizeObserver(invalidate);
    ro.observe(container);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [map]);
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

// Module-level set so "already fitted" survives component re-renders.
// Keyed by Leaflet map container element so different map instances
// are independent. Cleared when the container is removed from the DOM.
const fittedMaps = new WeakSet<HTMLElement>();

// Persists the last panned/zoomed view so navigating away and back
// restores the exact position instead of re-fitting everything.
type SavedView = { center: L.LatLng; zoom: number };
const savedViews = new Map<string, SavedView>();

/** Saves center+zoom to the module-level map on every move/zoom end. */
function SaveView({ viewKey, skip }: { viewKey: string; skip: boolean }) {
  const map = useMap();

  useEffect(() => {
    const save = () =>
      savedViews.set(viewKey, { center: map.getCenter(), zoom: map.getZoom() });

    if (skip) {
      // View was restored from saved state — start tracking right away.
      map.on("moveend zoomend", save);
      return () => {
        map.off("moveend zoomend", save);
      };
    }

    // Fresh mount — wait for FitToPlaces animation to finish before tracking.
    const t = window.setTimeout(() => {
      map.on("moveend zoomend", save);
    }, 800);
    return () => {
      window.clearTimeout(t);
      map.off("moveend zoomend", save);
    };
  }, [map, viewKey, skip]);

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
  const lastFitToken = useRef(fitToken);

  useEffect(() => {
    const container = map.getContainer();
    const tokenChanged = fitToken !== lastFitToken.current;
    lastFitToken.current = fitToken;

    const alreadyFitted = fittedMaps.has(container);
    if (alreadyFitted && !tokenChanged) return;
    if (skipInitialFit && !tokenChanged) {
      fittedMaps.add(container);
      return;
    }

    // Make sure Leaflet knows the real viewport size before we fit — the
    // map may have mounted before its container settled (sheet animation,
    // tab switch), in which case the cached size is wrong and the fit lands
    // on the wrong zoom/centre.
    map.invalidateSize({ animate: false });

    if (fitBoundsToPlaces) {
      // Pins may still be loading from Firestore. Don't lock in a "fitted"
      // view yet — center provisionally and let a later, non-empty render
      // actually fit the bounds.
      if (!places.length) {
        if (userLocation)
          map.setView([userLocation.lat, userLocation.lng], 11, {
            animate: false,
          });
        return;
      }
      const pts: [number, number][] = places.map((p) => [p.lat, p.lng]);
      if (userLocation) pts.push([userLocation.lat, userLocation.lng]);
      if (pts.length === 1) {
        // A single point has zero-area bounds, which makes fitBounds snap to
        // an extreme zoom — use a sensible fixed zoom instead.
        map.setView(pts[0], 13, { animate: true });
      } else {
        const bounds = L.latLngBounds(pts);
        map.fitBounds(bounds.pad(0.25), { animate: true, maxZoom: 13 });
      }
      fittedMaps.add(container);
    } else if (userLocation) {
      map.setView([userLocation.lat, userLocation.lng], 11, { animate: true });
      fittedMaps.add(container);
    }
  }, [places, userLocation, map, fitToken, fitBoundsToPlaces, skipInitialFit]);
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
