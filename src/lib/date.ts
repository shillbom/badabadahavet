/** Shared calendar math. All day/week anchoring in the app goes through
 *  here so every feature agrees on what "same day" and "same week" mean. */

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

const pad = (n: number) => n.toString().padStart(2, "0");

/** Format a Date as a local `YYYY-MM-DDTHH:mm` datetime-local string. */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Local midnight of the day containing `ts`. */
export function dayStartMs(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Local midnight of the Monday of the week containing `ts`. */
export function weekStartMs(ts: number): number {
  const d = new Date(ts);
  const day = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day).getTime();
}

/** Longest run of back-to-back weeks in a set of week-start timestamps
 *  (as produced by weekStartMs). Duplicates are fine; 0 when empty. */
export function longestConsecutiveWeeks(weekStarts: Iterable<number>): number {
  const weeks = [...new Set(weekStarts)].toSorted((a, b) => a - b);
  if (weeks.length === 0) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < weeks.length; i++) {
    if (weeks[i] - weeks[i - 1] === WEEK_MS) {
      run++;
      if (run > best) best = run;
    } else run = 1;
  }
  return best;
}

/**
 * Resolve a group's optional competition timespan into a half-open range
 * `[startMs, endExclusiveMs)` for session filtering. `endDate` is the last
 * *included* day, so the exclusive bound is the following midnight. Missing
 * bounds are open-ended: start falls back to 0, end to +Infinity.
 */
export function groupRangeMs(group: { startDate?: number; endDate?: number }): {
  startMs: number;
  endExclusiveMs: number;
} {
  return {
    startMs: group.startDate ?? 0,
    endExclusiveMs: group.endDate != null ? group.endDate + DAY_MS : Infinity,
  };
}

/** Format a day-start epoch ms as a short local `d MMM yyyy` label. */
export function formatDay(ts: number, locale: string): string {
  return new Date(ts).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Human range label for a group timespan, e.g. "1 jun 2026 – 31 aug 2026",
 * "from 1 jun 2026" (open end), or "until 31 aug 2026" (open start).
 * `openStart` / `openEnd` are the localized prefixes for the open-ended cases.
 * Returns null when the group has no timespan at all.
 */
export function formatGroupRange(
  group: { startDate?: number; endDate?: number },
  locale: string,
  labels: { openStart: string; openEnd: string },
): string | null {
  const hasStart = group.startDate != null;
  const hasEnd = group.endDate != null;
  if (!hasStart && !hasEnd) return null;
  if (hasStart && hasEnd)
    return `${formatDay(group.startDate!, locale)} – ${formatDay(group.endDate!, locale)}`;
  if (hasStart)
    return `${labels.openEnd} ${formatDay(group.startDate!, locale)}`;
  return `${labels.openStart} ${formatDay(group.endDate!, locale)}`;
}
