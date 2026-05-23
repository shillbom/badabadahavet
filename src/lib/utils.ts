import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { localeBcp } from "./i18n";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(d: Date | number) {
  const date = typeof d === "number" ? new Date(d) : d;
  return date.toLocaleDateString(localeBcp(), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(d: Date | number) {
  const date = typeof d === "number" ? new Date(d) : d;
  return date.toLocaleString(localeBcp(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
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
