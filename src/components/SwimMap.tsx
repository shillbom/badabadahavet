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
import { Link } from "react-router";
import {
  Layers,
  LocateFixed,
  MapPin,
  Maximize,
  Minimize,
  MoreVertical,
  Search,
  X,
} from "lucide-react";
import { MAP_THEMES } from "@/lib/mapThemes";
import Photo from "@/components/Photo";
import { watchPlaceSessions } from "@/lib/data";
import { maybeRefreshPlaceTemp } from "@/lib/refreshTemp";
import { pinRingFor } from "@/lib/borders";
import type { PlaceDoc, SessionDoc } from "@/lib/types";
import { formatDate, cn } from "@/lib/utils";
import { buttonClasses } from "@/components/ui/Button";
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
const CLUSTER_ON = 15;
const CLUSTER_OFF = 12;

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

// Reuses the same [lat, lng] tuple across renders for a given place so
// <Marker position={...}> only gets a new array when the coordinates
// actually change. Leaflet's Marker.setLatLng fires a "move" event
// unconditionally (even when the value is unchanged), and inside a
// MarkerClusterGroup that event unconditionally rips the marker out of the
// cluster grid and re-adds it (leaflet.markercluster's _childMarkerMoved ->
// _moveChild). A fresh `[p.lat, p.lng]` literal on every render — which
// `places.map(...)` produces every time the Firestore listener re-emits —
// was therefore rebuilding every marker on the map on every re-render,
// which is what made clicking a pin (which re-renders SwimMap 2-3 times via
// popup autoPan + the temp-refresh echoing back) visibly flicker.
const positionCache = new Map<string, [number, number]>();
function stablePosition(
  id: string,
  lat: number,
  lng: number,
): [number, number] {
  const cached = positionCache.get(id);
  if (cached && cached[0] === lat && cached[1] === lng) return cached;
  const next: [number, number] = [lat, lng];
  positionCache.set(id, next);
  return next;
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

/** One row in the ⋯ filter menu (see `menuToggles`): either a plain
 *  on/off checkbox, or — when `options` is present — a small segmented
 *  control for tri-state filters like the naturist only/on/off mode. */
export type MapMenuToggle =
  | {
      label: string;
      icon?: React.ReactNode;
      checked: boolean;
      onChange: (next: boolean) => void;
    }
  | {
      label: string;
      icon?: React.ReactNode;
      value: string;
      options: { value: string; label: string }[];
      onSelect: (value: string) => void;
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
  /** Collapses the top-right controls into a single ⋯ button that opens
   *  a filter menu: these rows plus a built-in satellite row. When set,
   *  `topRightActions` and the standalone satellite pill are not shown. */
  menuToggles?: MapMenuToggle[];
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
  /** Adds a fullscreen toggle to the action stack. Fullscreen expands the
   *  map to cover the whole viewport and reveals a spot-search bar. */
  fullscreenControl?: boolean;
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
  menuToggles,
  focusPlaceId,
  focusToken,
  fullscreenControl,
}: SwimMapProps) {
  const t = useT();
  const [satellite, setSatellite] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // ── Live per-place sessions for the open popup ────────────────────────
  // `sessionsByPlace` comes from the year-scoped community feed (and is empty
  // for guests / before the feed loads), so an open popup subscribes to ALL
  // of that place's sessions directly. The subscription lives up here — not
  // inside the popup content — because react-leaflet portals popup children
  // into a content node that persists after the popup closes, so a hook in
  // the content component would keep listeners alive for every popup ever
  // opened. Leaflet only shows one popup at a time → at most one listener.
  const [openPopupPlaceId, setOpenPopupPlaceId] = useState<string | null>(null);
  const [livePopupSessions, setLivePopupSessions] = useState<
    SessionDoc[] | null
  >(null);
  useEffect(() => {
    if (!openPopupPlaceId) return;
    setLivePopupSessions(null);
    return watchPlaceSessions(openPopupPlaceId, setLivePopupSessions);
  }, [openPopupPlaceId]);
  // Feed data fills the popup instantly; the live snapshot replaces it.
  const popupSessionsFor = (placeId: string): SessionDoc[] =>
    openPopupPlaceId === placeId && livePopupSessions
      ? livePopupSessions
      : (sessionsByPlace.get(placeId) ?? []);
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
  // ── Fullscreen spot search ────────────────────────────────────────────
  // Picking a result focuses that place (fly + open popup) via the same
  // machinery as the focusPlaceId prop. Coordinates are captured at pick
  // time so a Firestore re-emit of `places` can't re-trigger the flight.
  const [query, setQuery] = useState("");
  const [searchFocus, setSearchFocus] = useState<{
    lat: number;
    lng: number;
    id: string;
    token: number;
  } | null>(null);
  const searchSeq = useRef(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const starts: PlaceDoc[] = [];
    const contains: PlaceDoc[] = [];
    for (const p of places) {
      const name = p.name.toLowerCase();
      if (name.startsWith(q)) starts.push(p);
      else if (name.includes(q)) contains.push(p);
    }
    const byName = (a: PlaceDoc, b: PlaceDoc) => a.name.localeCompare(b.name);
    return [...starts.sort(byName), ...contains.sort(byName)].slice(0, 8);
  }, [query, places]);

  const pickSearchResult = useCallback((p: PlaceDoc) => {
    setSearchFocus({
      lat: p.lat,
      lng: p.lng,
      id: p.id,
      token: ++searchSeq.current,
    });
    setQuery("");
    searchInputRef.current?.blur();
  }, []);

  const toggleFullscreen = useCallback(() => {
    setFullscreen((v) => !v);
    setQuery("");
    setSearchFocus(null);
  }, []);

  // Escape exits fullscreen (desktop nicety).
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") toggleFullscreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, toggleFullscreen]);

  const focusTarget = useMemo(() => {
    if (searchFocus) return searchFocus;
    if (!focusPlaceId) return null;
    const p = places.find((pl) => pl.id === focusPlaceId);
    return p
      ? { lat: p.lat, lng: p.lng, id: p.id, token: focusToken ?? 0 }
      : null;
  }, [searchFocus, focusPlaceId, focusToken, places]);
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
      new Set(
        [activePlaceId, focusPlaceId, searchFocus?.id].filter(
          (id): id is string => !!id,
        ),
      ),
    [activePlaceId, focusPlaceId, searchFocus],
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
    <div
      className={
        fullscreen
          ? // Fullscreen keeps the same Leaflet instance mounted — the wrapper
            // just becomes a viewport-covering fixed overlay (above the app
            // chrome; header/nav sit at z-1000/1010).
            "fixed inset-0 z-[1200] bg-slate-100"
          : cn("relative h-full w-full", className)
      }
    >
      <MapContainer
        center={saved?.center ?? center ?? fallbackCenter}
        zoom={saved?.zoom ?? fallbackZoom}
        scrollWheelZoom
        dragging={!lockPan}
        doubleClickZoom
        touchZoom
        boxZoom={!lockPan}
        keyboard={!lockPan}
        className={cn("h-full w-full", !fullscreen && "rounded-2xl")}
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
                position={stablePosition(p.id, p.lat, p.lng)}
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
                  popupopen: () => setOpenPopupPlaceId(p.id),
                  popupclose: () =>
                    setOpenPopupPlaceId((cur) => (cur === p.id ? null : cur)),
                }}
              >
                {/* Only show popup when not in logging mode — clicking a
                    pin while logging selects it immediately instead. */}
                {!isPickable ? (
                  <PlacePopup
                    place={p}
                    sessions={popupSessionsFor(p.id)}
                    linkToSpot={linkToSpot}
                  />
                ) : null}
              </Marker>
            );
          })}
        </MarkerClusterGroup>
        {/* The active (picked) and focused places render outside the cluster
            group with the orange highlight icon, so they're never merged into
            a cluster bubble regardless of zoom level. */}
        {unclusteredPlaces.map((p) => {
          const isPickable =
            !!onPickExisting && (!canPickExisting || canPickExisting(p));
          return (
            <Marker
              key={`active-${p.id}`}
              ref={(m) => {
                if (m) markerRefs.current.set(p.id, m);
                else markerRefs.current.delete(p.id);
              }}
              position={stablePosition(p.id, p.lat, p.lng)}
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
                popupopen: () => setOpenPopupPlaceId(p.id),
                popupclose: () =>
                  setOpenPopupPlaceId((cur) => (cur === p.id ? null : cur)),
              }}
            >
              {!isPickable ? (
                <PlacePopup
                  place={p}
                  sessions={popupSessionsFor(p.id)}
                  linkToSpot={linkToSpot}
                />
              ) : null}
            </Marker>
          );
        })}
        {pickedAt && !activePlaceId ? (
          <Marker position={[pickedAt.lat, pickedAt.lng]} icon={newSwimIcon} />
        ) : null}
        {onPick ? <ClickToPick onPick={onPick} /> : null}
      </MapContainer>
      {/* Spot search — fullscreen only, pinned across the top (the action
          stack moves down below it while it's visible). */}
      {fullscreenControl && fullscreen ? (
        // left-14 keeps clear of Leaflet's zoom control (top-left, ~44px).
        <div className="absolute top-[max(env(safe-area-inset-top),0.75rem)] right-3 left-14 z-[650]">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchResults[0])
                  pickSearchResult(searchResults[0]);
              }}
              placeholder={t("map.search.placeholder")}
              aria-label={t("map.search.placeholder")}
              className="w-full rounded-full bg-white/95 py-2.5 pr-9 pl-9 text-sm text-wave-900 shadow-md ring-1 ring-slate-200 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-wave-400 [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label={t("common.close")}
                className="absolute top-1/2 right-2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          {query.trim() ? (
            <ul className="mt-2 max-h-64 overflow-y-auto rounded-2xl bg-white/95 shadow-lg ring-1 ring-slate-200 backdrop-blur">
              {searchResults.length === 0 ? (
                <li className="px-3 py-2.5 text-sm text-slate-500">
                  {t("map.search.no_results")}
                </li>
              ) : (
                searchResults.map((p) => {
                  const swims = sessionsByPlace.get(p.id)?.length ?? 0;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => pickSearchResult(p)}
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition hover:bg-wave-50"
                      >
                        <MapPin className="h-3.5 w-3.5 flex-none text-wave-600" />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-wave-900">
                          {p.name}
                        </span>
                        <span className="flex-none text-[11px] text-slate-500">
                          {swims === 1
                            ? t("map.popup.swims_one")
                            : swims > 0
                              ? t("map.popup.swims_many", { n: swims })
                              : t("map.popup.no_swims_yet")}
                          {hasFreshTemp(p)
                            ? ` · 💧 ${Math.round(p.waterTemp)}°`
                            : ""}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* Stacked action buttons — caller-supplied actions on top, the
          built-in satellite + fullscreen toggles at the bottom of the stack.
          With `menuToggles`, the whole stack collapses into one ⋯ button
          that opens a filter menu (satellite becomes a row in it).
          In fullscreen the stack drops below the search bar. */}
      <div
        className={cn(
          "absolute right-3 z-[600] flex flex-col items-end gap-2",
          fullscreen
            ? "top-[calc(max(env(safe-area-inset-top),0.75rem)+3.5rem)]"
            : "top-3",
        )}
      >
        {menuToggles && menuToggles.length > 0 ? (
          <MapFilterMenu
            ariaLabel={t("map.filters")}
            toggles={[
              ...menuToggles,
              {
                label: t("map.toggle_satellite"),
                checked: satellite,
                onChange: setSatellite,
                icon: <Layers className="h-3.5 w-3.5" />,
              },
            ]}
          />
        ) : (
          <>
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
          </>
        )}
      </div>

      {/* Round icon buttons — bottom right, Google Maps style: fullscreen
          toggle stacked above "locate me". */}
      <div
        className={cn(
          "absolute right-3 z-[600] flex flex-col gap-2",
          fullscreen
            ? "bottom-[max(env(safe-area-inset-bottom),1.25rem)]"
            : "bottom-5",
        )}
      >
        {fullscreenControl ? (
          <button
            type="button"
            onClick={toggleFullscreen}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-wave-700 shadow-md ring-1 ring-slate-200 transition hover:bg-white active:scale-95"
            aria-label={
              fullscreen ? t("map.exit_fullscreen") : t("map.fullscreen")
            }
            title={fullscreen ? t("map.exit_fullscreen") : t("map.fullscreen")}
          >
            {fullscreen ? (
              <Minimize className="h-5 w-5" />
            ) : (
              <Maximize className="h-5 w-5" />
            )}
          </button>
        ) : null}
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
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-wave-700 shadow-md ring-1 ring-slate-200 transition hover:bg-white active:scale-95"
            aria-label={t("map.center_on_me")}
            title={t("map.center_on_me")}
          >
            <LocateFixed className="h-5 w-5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The ⋯ button + dropdown panel of on/off filter rows. An invisible
 * fixed backdrop closes it on any outside tap (cheaper and more reliable
 * on the map than document-level listeners fighting Leaflet's handlers).
 */
function MapFilterMenu({
  toggles,
  ariaLabel,
}: {
  toggles: MapMenuToggle[];
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel}
        title={ariaLabel}
        aria-expanded={open}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-wave-700 shadow-md ring-1 ring-slate-200 transition hover:bg-white active:scale-95"
      >
        <MoreVertical className="h-5 w-5" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-white/95 p-1.5 shadow-lg ring-1 ring-slate-200">
            {toggles.map((tg, i) =>
              "options" in tg ? (
                <div
                  key={i}
                  className="rounded-xl px-2.5 py-2 text-sm font-medium text-slate-700"
                >
                  <span className="flex items-center gap-2">
                    {tg.icon}
                    {tg.label}
                  </span>
                  <div className="mt-1.5 flex rounded-full bg-slate-100 p-0.5">
                    {tg.options.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => tg.onSelect(o.value)}
                        className={cn(
                          "flex-1 rounded-full px-2 py-1 text-[11px] font-semibold transition",
                          tg.value === o.value
                            ? "bg-white text-wave-800 shadow-sm ring-1 ring-slate-200"
                            : "text-slate-500 hover:text-slate-700",
                        )}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <label
                  key={i}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-2.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <span className="flex items-center gap-2">
                    {tg.icon}
                    {tg.label}
                  </span>
                  <input
                    type="checkbox"
                    checked={tg.checked}
                    onChange={(e) => tg.onChange(e.target.checked)}
                    className="h-4 w-4 flex-none rounded border-slate-300 text-wave-600 focus:ring-wave-400"
                  />
                </label>
              ),
            )}
          </div>
        </>
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
    // Recenter immediately — the map may sit at a stale position (restored
    // saved view, or the pre-geolocation fallback) when the target arrives,
    // and with lockPan the user can't correct it themselves.
    recenter();
    // And snap back after every zoom so a locked map can't drift away.
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

/** How many photos a popup shows at most. With more than this, the last
 *  slot becomes a "+N" tile instead, so the strip never needs scrolling. */
const POPUP_MAX_PHOTOS = 4;

/**
 * The pin popup body, shared by the clustered and unclustered markers.
 * `sessions` is either the live all-time per-place subscription (once the
 * popup has opened and the snapshot arrived) or the year-scoped feed
 * fallback — the fallback is unordered, so sort here to make "latest"
 * mean the same thing for both.
 */
function PlacePopup({
  place,
  sessions,
  linkToSpot,
}: {
  place: PlaceDoc;
  sessions: SessionDoc[];
  linkToSpot: boolean;
}) {
  const t = useT();
  const sorted = useMemo(
    () => [...sessions].sort((a, b) => b.date - a.date),
    [sessions],
  );
  const photoSessions = sorted.filter((s) => s.photoUrl);
  const shown =
    photoSessions.length > POPUP_MAX_PHOTOS
      ? photoSessions.slice(0, POPUP_MAX_PHOTOS - 1)
      : photoSessions;
  const overflow = photoSessions.length - shown.length;
  const lastSession = sorted[0] ?? null;
  const moreTileClasses =
    "flex h-12 w-12 flex-none items-center justify-center rounded-md bg-wave-50 text-xs font-bold text-wave-700 ring-1 ring-slate-200";

  return (
    <Popup
      autoPanPaddingTopLeft={POPUP_AUTO_PAN_TOP_LEFT}
      autoPanPaddingBottomRight={POPUP_AUTO_PAN_BOTTOM_RIGHT}
    >
      <div className="text-sm">
        <div className="font-semibold text-wave-900">{place.name}</div>
        <div className="text-[11px] text-slate-500">
          {sorted.length === 1
            ? t("map.popup.swims_one")
            : sorted.length > 0
              ? t("map.popup.swims_many", { n: sorted.length })
              : t("map.popup.no_swims_yet")}
        </div>
        {hasFreshTemp(place) ? (
          <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800 ring-1 ring-sky-200">
            💧 {place.waterTemp.toFixed(1)} °C
            {place.waterTempAt ? (
              <span className="font-normal text-sky-600">
                · {formatAge(place.waterTempAt, t)}
              </span>
            ) : null}
          </div>
        ) : null}
        {shown.length ? (
          <div className="mt-1.5 flex gap-1 overflow-x-auto">
            {shown.map((s) => (
              <Photo
                key={s.id}
                src={s.photoUrl!}
                thumb={s.photoThumb}
                className="h-12 w-12 flex-none rounded-md ring-1 ring-slate-200"
              />
            ))}
            {overflow > 0 ? (
              linkToSpot ? (
                <Link
                  to={`/spot/${place.id}`}
                  aria-label={t("map.popup.view_spot")}
                  className={cn(moreTileClasses, "no-underline")}
                >
                  {t("map.popup.more_photos", { n: overflow })}
                </Link>
              ) : (
                <div className={moreTileClasses}>
                  {t("map.popup.more_photos", { n: overflow })}
                </div>
              )
            ) : null}
          </div>
        ) : null}
        {lastSession ? (
          <div className="mt-1 text-[11px]">
            {formatDate(lastSession.date)} — {lastSession.displayName}
            {lastSession.isWinter ? " ❄️" : ""}
          </div>
        ) : null}
        {linkToSpot ? (
          <Link
            to={`/spot/${place.id}`}
            className={buttonClasses(
              "primary",
              "xs",
              "mt-2 w-full !text-white no-underline hover:!text-white",
            )}
          >
            {t("map.popup.view_spot")}
          </Link>
        ) : null}
      </div>
    </Popup>
  );
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
