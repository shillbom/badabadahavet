/**
 * Scoring rules for Badligan.
 *
 * Per-session points (awarded at log time):
 *   A  May–Sep, home country ........... 1
 *   B  Apr & Oct, home country .......... 2
 *   C  Mar & Nov, home country .......... 3
 *   D  Jan, Feb, Dec, home country ...... 4
 *   H  New spot (any country) ........... +2
 *   J  Christmas Eve, home country ...... +5
 *
 * Abroad: 0 base points. The +4-per-country bonus (rule G) is awarded
 * as a separate per-user stat from distinct foreign country codes.
 */

export const POINTS_NEW_PLACE = 2;
export const POINTS_CHRISTMAS_EVE = 5;
export const PLACE_RADIUS_METERS = 100;

export type MonthCategory = "A" | "B" | "C" | "D";

export function monthCategory(month: number): {
  category: MonthCategory;
  points: number;
} {
  // month: 0–11 (Jan = 0)
  if (month >= 4 && month <= 8) return { category: "A", points: 1 }; // May–Sep
  if (month === 3 || month === 9) return { category: "B", points: 2 }; // Apr, Oct
  if (month === 2 || month === 10) return { category: "C", points: 3 }; // Mar, Nov
  return { category: "D", points: 4 }; // Jan, Feb, Dec
}

export function isChristmasEve(d: Date | number): boolean {
  const date = typeof d === "number" ? new Date(d) : d;
  return date.getMonth() === 11 && date.getDate() === 24;
}

export function isWinterMonth(d: Date | number): boolean {
  // Kept for backwards-compat displays — categories C and D are "winter-y".
  const date = typeof d === "number" ? new Date(d) : d;
  const m = date.getMonth();
  return m === 10 || m === 11 || m === 0 || m === 1 || m === 2;
}

import { COLD_CLIMATE_COUNTRIES } from "./countries";

/**
 * Resolve whether a swim counts as "home" and which bracket applies.
 *
 *   - Cold-climate home (SE/NO/DK/FI/IS/EE/LV/LT): home only when swim
 *     country matches; full A–D bracket; Christmas bonus eligible.
 *   - "OTHER" home: every swim is treated as home but always category A.
 *   - Anything else (no homeCountry set yet): abroad.
 */
export function resolveHomeBracket(
  homeCountry: string | null | undefined,
  country: string | null | undefined,
  month: number,
): { isHome: boolean; category: MonthCategory; basePoints: number } {
  const home = homeCountry ?? null;
  if (home === "OTHER") {
    return { isHome: true, category: "A", basePoints: 1 };
  }
  if (home && COLD_CLIMATE_COUNTRIES.has(home)) {
    if (country && country === home) {
      const { category, points } = monthCategory(month);
      return { isHome: true, category, basePoints: points };
    }
    return { isHome: false, category: "A", basePoints: 0 };
  }
  // No home country yet — treat as abroad, no base points.
  return { isHome: false, category: "A", basePoints: 0 };
}

export function scoreSession(opts: {
  isUniqueForUser: boolean;
  date: Date | number;
  country?: string | null;
  homeCountry?: string | null;
}): {
  points: number;
  isWinter: boolean;
  isHomeCountry: boolean;
  monthCategory: MonthCategory;
} {
  const date = typeof opts.date === "number" ? new Date(opts.date) : opts.date;
  const { isHome, category, basePoints } = resolveHomeBracket(
    opts.homeCountry,
    opts.country,
    date.getMonth(),
  );
  let points = basePoints;
  if (opts.isUniqueForUser) points += POINTS_NEW_PLACE;
  // Christmas-Eve bonus only applies to cold-climate homes (it's a Nordic
  // tradition); OTHER-home users still get their category-A base.
  if (isHome && opts.homeCountry !== "OTHER" && isChristmasEve(date))
    points += POINTS_CHRISTMAS_EVE;
  return {
    points,
    isWinter: isWinterMonth(date),
    isHomeCountry: isHome,
    monthCategory: category,
  };
}

export function startOfYear(year: number): number {
  return new Date(year, 0, 1).getTime();
}
export function endOfYear(year: number): number {
  return new Date(year + 1, 0, 1).getTime() - 1;
}
