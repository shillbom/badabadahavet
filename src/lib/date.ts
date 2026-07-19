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
