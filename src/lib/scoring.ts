/**
 * Scoring rules for Badligan.
 *
 * Deliberately simple so anyone can do the maths in their head:
 *
 *   • Each logged swim ................. +1
 *   • First swim at a brand-new spot ... +3
 *   • Winter dip (Nov–Mar) ............. +2
 *
 * Achievements grant separate bonus points (see achievements.ts) and a
 * swimmer "rank" that decorates their pins/profile (see ranks.ts). There
 * are no month brackets, home-country brackets, or country bonuses — the
 * old seasonal multipliers were impossible to reason about.
 */

export const POINTS_PER_SWIM = 1;
export const POINTS_NEW_SPOT = 3;
export const POINTS_WINTER = 2;
export const PLACE_RADIUS_METERS = 100;

export function isWinterMonth(d: Date | number): boolean {
  // Nov, Dec, Jan, Feb, Mar — the cold-water months.
  const date = typeof d === "number" ? new Date(d) : d;
  const m = date.getMonth();
  return m === 10 || m === 11 || m === 0 || m === 1 || m === 2;
}

/**
 * Whether a swim counts as being in the user's home country. Used only for
 * the "countries abroad" display stat — it does not affect points.
 */
export function isHomeSwim(
  homeCountry: string | null | undefined,
  country: string | null | undefined,
): boolean {
  if (!homeCountry || homeCountry === "OTHER") return false;
  return !!country && country === homeCountry;
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
} {
  const isWinter = isWinterMonth(opts.date);
  let points = POINTS_PER_SWIM;
  if (opts.isUniqueForUser) points += POINTS_NEW_SPOT;
  if (isWinter) points += POINTS_WINTER;
  return {
    points,
    isWinter,
    isHomeCountry: isHomeSwim(opts.homeCountry, opts.country),
  };
}

/** Points a swim *will* earn, for previews before it's logged. */
export function previewPoints(opts: {
  isNewSpot: boolean;
  isWinter: boolean;
}): number {
  return (
    POINTS_PER_SWIM +
    (opts.isNewSpot ? POINTS_NEW_SPOT : 0) +
    (opts.isWinter ? POINTS_WINTER : 0)
  );
}

export function startOfYear(year: number): number {
  return new Date(year, 0, 1).getTime();
}
export function endOfYear(year: number): number {
  return new Date(year + 1, 0, 1).getTime() - 1;
}
