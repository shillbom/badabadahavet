/**
 * Scoring rules for badabadahavet:
 *   - +1 per swim session
 *   - +2 if it's the user's first swim at this place
 *   - +2 winter bonus when the swim falls in Nov–Mar (months 0,1,2,10,11)
 */

export const POINTS_PER_SESSION = 1;
export const POINTS_NEW_PLACE = 2;
export const POINTS_WINTER = 2;
export const PLACE_RADIUS_METERS = 100;

export function isWinterMonth(d: Date | number): boolean {
  const date = typeof d === "number" ? new Date(d) : d;
  const m = date.getMonth();
  return m === 10 || m === 11 || m === 0 || m === 1 || m === 2;
}

export function scoreSession(opts: {
  isUniqueForUser: boolean;
  date: Date | number;
}): { points: number; isWinter: boolean } {
  const isWinter = isWinterMonth(opts.date);
  let points = POINTS_PER_SESSION;
  if (opts.isUniqueForUser) points += POINTS_NEW_PLACE;
  if (isWinter) points += POINTS_WINTER;
  return { points, isWinter };
}

export function startOfYear(year: number): number {
  return new Date(year, 0, 1).getTime();
}
export function endOfYear(year: number): number {
  return new Date(year + 1, 0, 1).getTime() - 1;
}
