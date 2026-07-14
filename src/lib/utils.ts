import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { localeBcp } from "./i18n";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// toLocale*String constructs a fresh Intl.DateTimeFormat on every call —
// too expensive for the per-row calls in swim lists. Cache one formatter per
// locale instead (two entries in practice: sv + en).
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function cachedFormatter(kind: string, opts: Intl.DateTimeFormatOptions) {
  const locale = localeBcp();
  const key = `${kind}:${locale}`;
  let fmt = formatterCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, opts);
    formatterCache.set(key, fmt);
  }
  return fmt;
}

export function formatDate(d: Date | number) {
  return cachedFormatter("date", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
}

export function formatDateTime(d: Date | number) {
  return cachedFormatter("datetime", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

const EARTH_RADIUS_M = 6_371_000;

const toRad = (x: number) => (x * Math.PI) / 180;

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  return haversineMeters(a, b) / 1000;
}

export function generateGroupCode(length = 5) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < length; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}

/**
 * Stash the current path so login (email or Google) can return to it.
 * Skips the login + Google redirect pages so we never recurse to them.
 */
export function rememberReturnPath() {
  if (typeof window === "undefined") return;
  const here =
    window.location.pathname + window.location.search + window.location.hash;
  if (!here || here.startsWith("/login") || here.startsWith("/auth/google"))
    return;
  try {
    sessionStorage.setItem("login.returnTo", here);
  } catch {
    /* sessionStorage may be unavailable (private mode) */
  }
}

/**
 * Read and clear the saved return path. Returns `fallback` (default "/")
 * when nothing was saved or the saved value isn't a safe same-origin path.
 */
export function consumeReturnPath(fallback = "/"): string {
  if (typeof window === "undefined") return fallback;
  try {
    const saved = sessionStorage.getItem("login.returnTo");
    sessionStorage.removeItem("login.returnTo");
    if (saved && saved.startsWith("/") && !saved.startsWith("//")) return saved;
  } catch {
    /* fall through */
  }
  return fallback;
}

/**
 * Share a URL via the Web Share API when available, otherwise copy to the
 * clipboard. Returns "shared" / "copied" / "failed" so the caller can show
 * the right toast.
 */
export async function shareOrCopy(opts: {
  url: string;
  title?: string;
  text?: string;
}): Promise<"shared" | "copied" | "failed"> {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  if (nav?.share) {
    try {
      await nav.share({ url: opts.url, title: opts.title, text: opts.text });
      return "shared";
    } catch (err) {
      // AbortError means the user dismissed the share sheet — that's not
      // a failure, just a no-op.
      if ((err as { name?: string })?.name === "AbortError") return "shared";
      // Otherwise fall through to clipboard fallback.
    }
  }
  if (nav?.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(opts.url);
      return "copied";
    } catch {
      /* fall through */
    }
  }
  return "failed";
}
