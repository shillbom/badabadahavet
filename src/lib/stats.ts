import { computeStreak, type StreakInfo } from "./streak";
import { DAY_MS, WEEK_MS, dayStartMs, weekStartMs } from "./date";
import type { SessionDoc } from "./types";

export type MyStats = {
  totalSwims: number;
  totalPoints: number;
  uniquePlaces: number;
  winterSwims: number;
  /** Skip-day-aware day streak; `currentDayStreak` mirrors `streak.current`. */
  streak: StreakInfo;
  currentDayStreak: number;
  daysSinceLast: number | null;
  currentWeekStreak: number;
  longestWeekStreak: number;
  favouriteSpot: { placeId: string; name: string; count: number } | null;
  bestMonth: { month: number; points: number } | null;
  range: { km: number } | null;
  onThisDay: SessionDoc | null;
  countriesAbroad: number;
  /** Swims in the trailing 7 / 30 days — recent-activity momentum. */
  swimsLastWeek: number;
  swimsLastMonth: number;
};

function weekKey(ts: number): string {
  const start = new Date(weekStartMs(ts));
  return `${start.getFullYear()}-${start.getMonth()}-${start.getDate()}`;
}

export function computeMyStats(sessions: SessionDoc[]): MyStats {
  if (sessions.length === 0) {
    return {
      totalSwims: 0,
      totalPoints: 0,
      uniquePlaces: 0,
      winterSwims: 0,
      streak: computeStreak([]),
      currentDayStreak: 0,
      daysSinceLast: null,
      currentWeekStreak: 0,
      longestWeekStreak: 0,
      favouriteSpot: null,
      bestMonth: null,
      range: null,
      onThisDay: null,
      countriesAbroad: 0,
      swimsLastWeek: 0,
      swimsLastMonth: 0,
    };
  }

  let totalPoints = 0;
  let winterSwims = 0;
  const placeCounts = new Map<string, { name: string; count: number }>();
  const monthPoints = new Array(12).fill(0) as number[];
  const weekSet = new Set<string>();
  const abroadCountries = new Set<string>();
  let lats: number[] = [];
  let lngs: number[] = [];
  const now = Date.now();
  const weekAgo = now - 7 * DAY_MS;
  const monthAgo = now - 30 * DAY_MS;
  let swimsLastWeek = 0;
  let swimsLastMonth = 0;

  for (const s of sessions) {
    totalPoints += s.points;
    if (s.isWinter) winterSwims++;
    if (s.date >= weekAgo) swimsLastWeek++;
    if (s.date >= monthAgo) swimsLastMonth++;
    const cur = placeCounts.get(s.placeId) ?? { name: s.placeName, count: 0 };
    cur.count += 1;
    cur.name = s.placeName;
    placeCounts.set(s.placeId, cur);
    monthPoints[new Date(s.date).getMonth()] += s.points;
    weekSet.add(weekKey(s.date));
    if (!s.isHomeCountry && s.country) abroadCountries.add(s.country);
    lats.push(s.lat);
    lngs.push(s.lng);
  }

  const sortedDesc = [...sessions].sort((a, b) => b.date - a.date);
  const lastDate = sortedDesc[0].date;

  // Difference in *calendar days* (round, not floor) so "yesterday at 14:00"
  // read at "today 09:00" reports 1, not 0. Also dodges DST hour jumps.
  const daysSinceLast = Math.round(
    (dayStartMs(Date.now()) - dayStartMs(lastDate)) / DAY_MS,
  );

  // Day streak with skip days — see lib/streak.ts for the rules.
  const streak = computeStreak(sessions.map((s) => s.date));

  // Week streaks: walk back week-by-week from the most recent swim's week.
  const weeksWithSwim = new Set<number>(
    [...weekSet].map((k) => {
      const [y, m, d] = k.split("-").map(Number);
      return new Date(y, m, d).getTime();
    }),
  );
  let currentWeekStreak = 0;
  let cursor = weekStartMs(Date.now());
  // If the most recent swim is in *this* week, start the streak from this week.
  // Otherwise from last week.
  if (!weeksWithSwim.has(cursor)) cursor -= WEEK_MS;
  while (weeksWithSwim.has(cursor)) {
    currentWeekStreak++;
    cursor -= WEEK_MS;
  }
  // Longest streak across history
  const sortedWeeks = [...weeksWithSwim].sort((a, b) => a - b);
  let longestWeekStreak = 0;
  let run = 0;
  let prev = -1;
  for (const w of sortedWeeks) {
    if (prev === -1 || w - prev === WEEK_MS) {
      run++;
    } else {
      run = 1;
    }
    if (run > longestWeekStreak) longestWeekStreak = run;
    prev = w;
  }

  // Favourite spot
  let favouriteSpot: MyStats["favouriteSpot"] = null;
  for (const [placeId, v] of placeCounts) {
    if (!favouriteSpot || v.count > favouriteSpot.count)
      favouriteSpot = { placeId, name: v.name, count: v.count };
  }

  // Best month (over all years pooled)
  let bestMonth: MyStats["bestMonth"] = null;
  for (let i = 0; i < 12; i++) {
    if (!bestMonth || monthPoints[i] > bestMonth.points)
      bestMonth = { month: i, points: monthPoints[i] };
  }
  if (bestMonth && bestMonth.points === 0) bestMonth = null;

  // Range — bounding-box diagonal in km
  let range: MyStats["range"] = null;
  if (lats.length > 1) {
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const km = haversineKm(
      { lat: minLat, lng: minLng },
      { lat: maxLat, lng: maxLng },
    );
    if (km > 0.1) range = { km };
  }

  // On this day — most recent session whose month/day is today's, from at least
  // one calendar year ago (so we don't show today's swim).
  const today = new Date();
  const onThisDay =
    sortedDesc.find((s) => {
      const d = new Date(s.date);
      return (
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate() &&
        d.getFullYear() < today.getFullYear()
      );
    }) ?? null;

  return {
    totalSwims: sessions.length,
    totalPoints,
    uniquePlaces: placeCounts.size,
    winterSwims,
    streak,
    currentDayStreak: streak.current,
    daysSinceLast,
    currentWeekStreak,
    longestWeekStreak,
    favouriteSpot,
    bestMonth,
    range,
    onThisDay,
    countriesAbroad: abroadCountries.size,
    swimsLastWeek,
    swimsLastMonth,
  };
}

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}
