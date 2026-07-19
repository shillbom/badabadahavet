import L from "leaflet";
import type { PlaceWithTemp } from "@/lib/types";
import type { PinRing } from "./types";

// ── Recency tint ──────────────────────────────────────────────────────────
// A place's pin fades from full blue (swum within the last week) toward grey
// (no swim for ~two months, or never), so the map reads activity at a glance.
// The white temperature label stays legible across the whole range.
const FRESH_MS = 7 * 24 * 60 * 60 * 1000; // ≤ 1 week → full colour
const STALE_MS = 60 * 24 * 60 * 60 * 1000; // ≥ ~2 months → fully grey

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const PIN_SIZE = 28;
export const PIN_TAIL = 12;
export const PIN_TOTAL = PIN_SIZE + PIN_TAIL;

const ACTIVE_SIZE = 32;
const ACTIVE_TAIL = 14;
const ACTIVE_TOTAL = ACTIVE_SIZE + ACTIVE_TAIL;

/** 1 = swum recently (full colour) … 0 = long stale / never swum (grey). */
export function recencyFactor(lastSwimAt?: number): number {
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
export function recencyColours(hasTemp: boolean, factor: number) {
  const top = hasTemp ? BLUE_TEMP_TOP : BLUE_PLAIN_TOP;
  const bottom = hasTemp ? BLUE_TEMP_BOTTOM : BLUE_PLAIN_BOTTOM;
  return {
    bg: `linear-gradient(135deg,${mix(GREY_TOP, top, factor)},${mix(GREY_BOTTOM, bottom, factor)})`,
    tail: mix(GREY_BOTTOM, bottom, factor),
  };
}

// All pins share the same shape: a coloured circle with a small
// triangle tail. The tail's tip sits at the bottom-center of the icon
// box (iconAnchor = [w/2, h]) so it always lands exactly on the
// lat/lng — no off-by-anchor rotation tricks.
export function pinHtml(opts: {
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

// Cache pins keyed by "<temp-or-plain>|<rankId>" so we don't rebuild an
// icon for every marker on every render.
const pinIconCache = new Map<string, L.DivIcon>();

export function pinIcon(
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

// Cluster badge: child count, plus the average of any fresh temps below it.
// `factor` is the freshness of the most-recently-swum child, so a cluster
// greys out only once *all* its places are stale.
export function clusterIconHtml(
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

export const activePlaceIcon = L.divIcon({
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

export const newSwimIcon = L.divIcon({
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

export const userLocationIcon = L.divIcon({
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

/** Returns true only when a place has a numeric temp that is ≤ 7 days old. */
export function hasFreshTemp(
  p: PlaceWithTemp,
): p is PlaceWithTemp & { waterTemp: number; waterTempAt: number } {
  if (typeof p.waterTemp !== "number") return false;
  if (!p.waterTempAt) return false;
  return Date.now() - p.waterTempAt <= WEEK_MS;
}
