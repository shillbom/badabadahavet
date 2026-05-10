import type { SessionDoc } from "./types";

export type Achievement = {
  id: string;
  name: string;
  description: string;
  emoji: string;
  points: number;
  /** Bigger numbers feel more impressive. */
  tier: 1 | 2 | 3;
  /** Returns true if the achievement is unlocked for the given context. */
  test: (ctx: AchievementContext) => boolean;
  /** Returns 0..1 progress toward unlocking, used to show progress bars. */
  progress?: (ctx: AchievementContext) => number;
};

export type AchievementContext = {
  uid: string;
  mySessions: SessionDoc[];
  allSessions: SessionDoc[];
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function uniquePlaces(sessions: SessionDoc[]): number {
  const set = new Set<string>();
  for (const s of sessions) set.add(s.placeId);
  return set.size;
}

function winterCount(sessions: SessionDoc[]): number {
  return sessions.filter((s) => s.isWinter).length;
}

function weekStart(ts: number): number {
  const d = new Date(ts);
  const day = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day).getTime();
}

function bestWeekStreak(sessions: SessionDoc[]): number {
  if (sessions.length === 0) return 0;
  const weeks = [...new Set(sessions.map((s) => weekStart(s.date)))].sort(
    (a, b) => a - b,
  );
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

function rangeKm(sessions: SessionDoc[]): number {
  if (sessions.length < 2) return 0;
  const lats = sessions.map((s) => s.lat);
  const lngs = sessions.map((s) => s.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(maxLat - minLat);
  const dLng = toRad(maxLng - minLng);
  const lat1 = toRad(minLat);
  const lat2 = toRad(maxLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function distinctSwimmersAtMyPlaces(ctx: AchievementContext): number {
  const myPlaces = new Set(ctx.mySessions.map((s) => s.placeId));
  const max = new Map<string, Set<string>>();
  for (const s of ctx.allSessions) {
    if (!myPlaces.has(s.placeId)) continue;
    if (s.uid === ctx.uid) continue;
    const set = max.get(s.placeId) ?? new Set<string>();
    set.add(s.uid);
    max.set(s.placeId, set);
  }
  let best = 0;
  for (const v of max.values()) if (v.size > best) best = v.size;
  return best;
}

function countByHour(sessions: SessionDoc[], pred: (h: number) => boolean) {
  return sessions.filter((s) => pred(new Date(s.date).getHours())).length;
}

function distinctSeasons(sessions: SessionDoc[]): number {
  const seen = new Set<number>();
  for (const s of sessions) {
    const m = new Date(s.date).getMonth();
    // 0=winter (Dec-Feb), 1=spring (Mar-May), 2=summer (Jun-Aug), 3=autumn (Sep-Nov)
    const season =
      m === 11 || m === 0 || m === 1
        ? 0
        : m >= 2 && m <= 4
          ? 1
          : m >= 5 && m <= 7
            ? 2
            : 3;
    seen.add(season);
  }
  return seen.size;
}

const ach = (a: Achievement): Achievement => a;

export const ACHIEVEMENTS: Achievement[] = [
  ach({
    id: "ICE_BREAKER",
    name: "Ice breaker",
    description: "Log your first swim",
    emoji: "🌊",
    points: 1,
    tier: 1,
    test: (c) => c.mySessions.length >= 1,
    progress: (c) => Math.min(1, c.mySessions.length / 1),
  }),
  ach({
    id: "HABIT_FORMING",
    name: "Habit forming",
    description: "Five swims in the books",
    emoji: "🐬",
    points: 2,
    tier: 1,
    test: (c) => c.mySessions.length >= 5,
    progress: (c) => Math.min(1, c.mySessions.length / 5),
  }),
  ach({
    id: "FIFTY_DIPS",
    name: "Half-century",
    description: "50 swims logged",
    emoji: "🦭",
    points: 15,
    tier: 3,
    test: (c) => c.mySessions.length >= 50,
    progress: (c) => Math.min(1, c.mySessions.length / 50),
  }),
  ach({
    id: "COLLECTOR",
    name: "Spot collector",
    description: "Five unique spots",
    emoji: "📍",
    points: 3,
    tier: 1,
    test: (c) => uniquePlaces(c.mySessions) >= 5,
    progress: (c) => Math.min(1, uniquePlaces(c.mySessions) / 5),
  }),
  ach({
    id: "EXPLORER",
    name: "Explorer",
    description: "Fifteen unique spots",
    emoji: "🗺️",
    points: 10,
    tier: 2,
    test: (c) => uniquePlaces(c.mySessions) >= 15,
    progress: (c) => Math.min(1, uniquePlaces(c.mySessions) / 15),
  }),
  ach({
    id: "POLAR_BEAR",
    name: "Polar bear",
    description: "First winter dip",
    emoji: "❄️",
    points: 1,
    tier: 1,
    test: (c) => winterCount(c.mySessions) >= 1,
    progress: (c) => Math.min(1, winterCount(c.mySessions) / 1),
  }),
  ach({
    id: "COLD_PURIST",
    name: "Cold purist",
    description: "Five winter dips",
    emoji: "🧊",
    points: 5,
    tier: 2,
    test: (c) => winterCount(c.mySessions) >= 5,
    progress: (c) => Math.min(1, winterCount(c.mySessions) / 5),
  }),
  ach({
    id: "WINTER_WARRIOR",
    name: "Winter warrior",
    description: "Ten winter dips",
    emoji: "🥶",
    points: 10,
    tier: 3,
    test: (c) => winterCount(c.mySessions) >= 10,
    progress: (c) => Math.min(1, winterCount(c.mySessions) / 10),
  }),
  ach({
    id: "STREAK_3",
    name: "On a roll",
    description: "Three weeks in a row",
    emoji: "🔥",
    points: 3,
    tier: 1,
    test: (c) => bestWeekStreak(c.mySessions) >= 3,
    progress: (c) => Math.min(1, bestWeekStreak(c.mySessions) / 3),
  }),
  ach({
    id: "STREAK_6",
    name: "Unstoppable",
    description: "Six weeks in a row",
    emoji: "🔥",
    points: 10,
    tier: 3,
    test: (c) => bestWeekStreak(c.mySessions) >= 6,
    progress: (c) => Math.min(1, bestWeekStreak(c.mySessions) / 6),
  }),
  ach({
    id: "GLOBETROTTER",
    name: "Globetrotter",
    description: "Spots span 50 km",
    emoji: "🌍",
    points: 5,
    tier: 2,
    test: (c) => rangeKm(c.mySessions) >= 50,
    progress: (c) => Math.min(1, rangeKm(c.mySessions) / 50),
  }),
  ach({
    id: "WANDERLUST",
    name: "Wanderlust",
    description: "Spots span 250 km",
    emoji: "✈️",
    points: 15,
    tier: 3,
    test: (c) => rangeKm(c.mySessions) >= 250,
    progress: (c) => Math.min(1, rangeKm(c.mySessions) / 250),
  }),
  ach({
    id: "BUDDY_UP",
    name: "Buddy up",
    description: "Share a spot with another swimmer",
    emoji: "🤝",
    points: 2,
    tier: 1,
    test: (c) => distinctSwimmersAtMyPlaces(c) >= 1,
    progress: (c) => Math.min(1, distinctSwimmersAtMyPlaces(c) / 1),
  }),
  ach({
    id: "SOCIAL_BUTTERFLY",
    name: "Social butterfly",
    description: "Share a spot with 3+ others",
    emoji: "🦋",
    points: 5,
    tier: 2,
    test: (c) => distinctSwimmersAtMyPlaces(c) >= 3,
    progress: (c) => Math.min(1, distinctSwimmersAtMyPlaces(c) / 3),
  }),
  ach({
    id: "DAWN_PATROL",
    name: "Dawn patrol",
    description: "Three swims before 7 am",
    emoji: "🌅",
    points: 3,
    tier: 2,
    test: (c) => countByHour(c.mySessions, (h) => h < 7) >= 3,
    progress: (c) => Math.min(1, countByHour(c.mySessions, (h) => h < 7) / 3),
  }),
  ach({
    id: "NIGHT_OWL",
    name: "Night owl",
    description: "Three swims after 8 pm",
    emoji: "🌙",
    points: 3,
    tier: 2,
    test: (c) => countByHour(c.mySessions, (h) => h >= 20) >= 3,
    progress: (c) =>
      Math.min(1, countByHour(c.mySessions, (h) => h >= 20) / 3),
  }),
  ach({
    id: "ALL_SEASONS",
    name: "All seasons",
    description: "A dip in winter, spring, summer, autumn",
    emoji: "🍂",
    points: 5,
    tier: 2,
    test: (c) => distinctSeasons(c.mySessions) === 4,
    progress: (c) => distinctSeasons(c.mySessions) / 4,
  }),
];

export function evaluateAchievements(ctx: AchievementContext): Set<string> {
  const out = new Set<string>();
  for (const a of ACHIEVEMENTS) if (a.test(ctx)) out.add(a.id);
  return out;
}

export function bonusPointsFor(ctx: AchievementContext): number {
  const unlocked = evaluateAchievements(ctx);
  let pts = 0;
  for (const a of ACHIEVEMENTS) if (unlocked.has(a.id)) pts += a.points;
  return pts;
}

export function bonusPointsForUid(uid: string, allSessions: SessionDoc[]) {
  const mine = allSessions.filter((s) => s.uid === uid);
  return bonusPointsFor({ uid, mySessions: mine, allSessions });
}

export const ACHIEVEMENTS_BY_ID: Record<string, Achievement> =
  Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
