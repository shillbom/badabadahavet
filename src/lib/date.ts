/** Shared calendar math. All day/week anchoring in the app goes through
 *  here so every feature agrees on what "same day" and "same week" mean. */

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

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
