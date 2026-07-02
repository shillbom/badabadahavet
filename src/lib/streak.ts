/**
 * The single source of truth for day-streak math.
 *
 * Rules: swimming on consecutive calendar days builds a streak. Every 4th
 * swim day earns one "life buoy" (skip day) — a missed day is automatically
 * covered by a buoy, keeping the streak alive. 8 swim days = 2 buoys, and so
 * on. Buoys are earned and spent within a single streak; when a streak dies,
 * the balance resets with it.
 *
 * A streak's length counts swim days only — a buoy keeps the streak alive
 * over a missed day but doesn't make it longer.
 */

import { DAY_MS, dayStartMs } from "./date";

/** Swim days needed to earn one skip day. */
export const SWIM_DAYS_PER_SKIP = 4;

export type StreakDayType = "swim" | "skip";

export type StreakInfo = {
  /** Swim days in the active streak (buoy days don't count). 0 when broken. */
  current: number;
  /** Alias of `current` — distinct swim days within the active streak. */
  swimDays: number;
  /** Skip days consumed by the active streak. */
  skipsUsed: number;
  /** Skip days earned but not yet spent (floor(swimDays / 4) − used). */
  skipsAvailable: number;
  /** Day-start ms of the first day of the active streak, or null when broken. */
  currentStart: number | null;
  /** Longest streak ever, same rules (swim days). */
  longest: number;
  /** True when there's no swim today and no buoy left — swim today or lose it. */
  atRisk: boolean;
  /** True when the streak is alive but today's gap will spend a buoy tomorrow. */
  onBuoy: boolean;
  /** Every day that is part of any streak, for calendar rendering.
   *  Days absent from the map broke (or preceded) a streak. */
  dayTypes: Map<number, StreakDayType>;
};

/**
 * Longest streak (swim days) within one calendar year. A streak spanning
 * New Year counts only its in-year days, and buoy accounting restarts at
 * January 1st — each year stands on its own.
 */
export function longestStreakInYear(dates: number[], year: number): number {
  return computeStreak(dates.filter((d) => new Date(d).getFullYear() === year))
    .longest;
}

/**
 * Compute streak state from raw session timestamps (epoch ms, any order).
 * `now` is injectable for tests.
 */
export function computeStreak(dates: number[], now = Date.now()): StreakInfo {
  const dayTypes = new Map<number, StreakDayType>();
  const days = [...new Set(dates.map(dayStartMs))].sort((a, b) => a - b);
  const today = dayStartMs(now);

  if (days.length === 0) {
    return {
      current: 0,
      swimDays: 0,
      skipsUsed: 0,
      skipsAvailable: 0,
      currentStart: null,
      longest: 0,
      atRisk: false,
      onBuoy: false,
      dayTypes,
    };
  }

  // Walk swim days oldest → newest, splitting into runs. A gap between two
  // swim days survives when the buoys earned so far can cover every missed
  // day; otherwise the run ends and a new one starts.
  let runStart = days[0];
  let swimDays = 1;
  let skipsUsed = 0;
  let longest = 0;
  dayTypes.set(days[0], "swim");

  for (let i = 1; i < days.length; i++) {
    // Round, not divide-and-floor: local midnights straddling DST are ±1h off.
    const gap = Math.round((days[i] - days[i - 1]) / DAY_MS) - 1;
    const available = Math.floor(swimDays / SWIM_DAYS_PER_SKIP) - skipsUsed;
    if (gap > 0 && gap <= available) {
      for (let d = 1; d <= gap; d++)
        dayTypes.set(dayStartMs(days[i - 1] + d * DAY_MS), "skip");
      skipsUsed += gap;
    } else if (gap > 0) {
      longest = Math.max(longest, swimDays);
      runStart = days[i];
      swimDays = 0;
      skipsUsed = 0;
    }
    swimDays++;
    dayTypes.set(days[i], "swim");
  }

  // Is the last run still alive relative to today? Days strictly between the
  // last swim and today must each be covered by a buoy. Today itself never
  // needs one — the user can still swim.
  const lastSwim = days[days.length - 1];
  const gapToToday = Math.max(0, Math.round((today - lastSwim) / DAY_MS) - 1);
  const available = Math.floor(swimDays / SWIM_DAYS_PER_SKIP) - skipsUsed;
  const alive = gapToToday <= available;

  if (alive && gapToToday > 0) {
    for (let d = 1; d <= gapToToday; d++)
      dayTypes.set(dayStartMs(lastSwim + d * DAY_MS), "skip");
    skipsUsed += gapToToday;
  }
  longest = Math.max(longest, swimDays);

  if (!alive) {
    return {
      current: 0,
      swimDays: 0,
      skipsUsed: 0,
      skipsAvailable: 0,
      currentStart: null,
      longest,
      atRisk: false,
      onBuoy: false,
      dayTypes,
    };
  }

  const skipsAvailable = Math.floor(swimDays / SWIM_DAYS_PER_SKIP) - skipsUsed;
  const swamToday = lastSwim === today;
  return {
    current: swimDays,
    swimDays,
    skipsUsed,
    skipsAvailable,
    currentStart: runStart,
    longest,
    atRisk: !swamToday && skipsAvailable === 0,
    onBuoy: !swamToday && skipsAvailable > 0,
    dayTypes,
  };
}
