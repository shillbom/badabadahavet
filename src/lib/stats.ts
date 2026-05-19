import type { SessionDoc } from "./types";

export type MyStats = {
  totalSwims: number;
  totalPoints: number;
  uniquePlaces: number;
  winterSwims: number;
  currentDayStreak: number;
  daysSinceLast: number | null;
  currentWeekStreak: number;
  longestWeekStreak: number;
  favouriteSpot: { placeId: string; name: string; count: number } | null;
  bestMonth: { month: number; points: number } | null;
  range: { km: number } | null;
  onThisDay: SessionDoc | null;
  countriesAbroad: number;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function weekKey(ts: number): string {
  const d = new Date(ts);
  // Anchor weeks to Monday
  const day = (d.getDay() + 6) % 7;
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  return `${start.getFullYear()}-${start.getMonth()}-${start.getDate()}`;
}

function weekStartMs(ts: number): number {
  const d = new Date(ts);
  const day = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day).getTime();
}

function dayStartMs(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function computeMyStats(sessions: SessionDoc[]): MyStats {
  if (sessions.length === 0) {
    return {
      totalSwims: 0,
      totalPoints: 0,
      uniquePlaces: 0,
      winterSwims: 0,
      currentDayStreak: 0,
      daysSinceLast: null,
      currentWeekStreak: 0,
      longestWeekStreak: 0,
      favouriteSpot: null,
      bestMonth: null,
      range: null,
      onThisDay: null,
      countriesAbroad: 0,
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

  for (const s of sessions) {
    totalPoints += s.points;
    if (s.isWinter) winterSwims++;
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

  // Day streak: consecutive calendar days (today or yesterday counts as active).
  const daysWithSwim = new Set<number>(sessions.map((s) => dayStartMs(s.date)));
  let currentDayStreak = 0;
  let dayCursor = dayStartMs(Date.now());
  if (!daysWithSwim.has(dayCursor)) dayCursor -= DAY_MS;
  while (daysWithSwim.has(dayCursor)) {
    currentDayStreak++;
    dayCursor -= DAY_MS;
  }

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
    currentDayStreak,
    daysSinceLast,
    currentWeekStreak,
    longestWeekStreak,
    favouriteSpot,
    bestMonth,
    range,
    onThisDay,
    countriesAbroad: abroadCountries.size,
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
