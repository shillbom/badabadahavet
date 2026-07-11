import { longestConsecutiveWeeks, weekStartMs } from "./date";
import { computeStreak } from "./streak";
import { haversineKm } from "./utils";
import type { SessionDoc } from "./types";

export type AchievementContext = {
  uid: string;
  mySessions: SessionDoc[];
  allSessions: SessionDoc[];
};

/** Every aggregate an achievement can be judged on, computed in one pass
 *  over the context (see computeAchievementStats) instead of once per
 *  achievement — evaluateAchievements runs on every sessions snapshot. */
export type AchievementStats = {
  swims: number;
  uniquePlaces: number;
  winterSwims: number;
  /** Longest consecutive-week run ever. */
  bestWeekStreak: number;
  /** Longest day streak ever, buoy rules included — see lib/streak.ts. */
  bestDayStreak: number;
  /** Bounding-box diagonal of all swim spots, in km. */
  rangeKm: number;
  /** Swims before 7 am / after 8 pm. */
  earlySwims: number;
  lateSwims: number;
  /** Distinct meteorological seasons swum in (max 4). */
  seasons: number;
  /** Most *other* swimmers sharing any one of the user's spots. */
  maxSharedSwimmers: number;
};

export type Achievement = {
  id: string;
  name: string;
  description: string;
  emoji: string;
  /** Bigger numbers feel more impressive. Purely cosmetic — achievements
   *  grant no points; they unlock badges and border frames only. */
  tier: 1 | 2 | 3;
  /** Unlocks when this aggregate stat reaches `goal`; progress toward the
   *  unlock is `stat / goal`, clamped to 1. */
  metric: keyof AchievementStats;
  goal: number;
};

export function computeAchievementStats(
  ctx: AchievementContext,
): AchievementStats {
  const placeIds = new Set<string>();
  const weekStarts = new Set<number>();
  const seasons = new Set<number>();
  const dates: number[] = [];
  let winterSwims = 0;
  let earlySwims = 0;
  let lateSwims = 0;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const s of ctx.mySessions) {
    placeIds.add(s.placeId);
    weekStarts.add(weekStartMs(s.date));
    dates.push(s.date);
    if (s.isWinter) winterSwims++;
    if (s.lat < minLat) minLat = s.lat;
    if (s.lat > maxLat) maxLat = s.lat;
    if (s.lng < minLng) minLng = s.lng;
    if (s.lng > maxLng) maxLng = s.lng;
    const d = new Date(s.date);
    const h = d.getHours();
    if (h < 7) earlySwims++;
    if (h >= 20) lateSwims++;
    const m = d.getMonth();
    // 0=winter (Dec-Feb), 1=spring (Mar-May), 2=summer (Jun-Aug), 3=autumn (Sep-Nov)
    seasons.add(m === 11 || m <= 1 ? 0 : m <= 4 ? 1 : m <= 7 ? 2 : 3);
  }

  const rangeKm =
    ctx.mySessions.length < 2
      ? 0
      : haversineKm({ lat: minLat, lng: minLng }, { lat: maxLat, lng: maxLng });

  // Most distinct other swimmers at any one of the user's spots — the only
  // aggregate that scans the community feed.
  const sharers = new Map<string, Set<string>>();
  for (const s of ctx.allSessions) {
    if (s.uid === ctx.uid || !placeIds.has(s.placeId)) continue;
    const set = sharers.get(s.placeId) ?? new Set<string>();
    set.add(s.uid);
    sharers.set(s.placeId, set);
  }
  let maxSharedSwimmers = 0;
  for (const v of sharers.values())
    if (v.size > maxSharedSwimmers) maxSharedSwimmers = v.size;

  return {
    swims: ctx.mySessions.length,
    uniquePlaces: placeIds.size,
    winterSwims,
    bestWeekStreak: longestConsecutiveWeeks(weekStarts),
    bestDayStreak: computeStreak(dates).longest,
    rangeKm,
    earlySwims,
    lateSwims,
    seasons: seasons.size,
    maxSharedSwimmers,
  };
}

/** 0..1 progress toward unlocking, used to show progress bars. */
export function achievementProgress(
  a: Achievement,
  stats: AchievementStats,
): number {
  return Math.min(1, stats[a.metric] / a.goal);
}

const ach = (a: Achievement): Achievement => a;

export const ACHIEVEMENTS: Achievement[] = [
  ach({
    id: "ICE_BREAKER",
    name: "Ice breaker",
    description: "Log your first swim",
    emoji: "🌊",
    tier: 1,
    metric: "swims",
    goal: 1,
  }),
  ach({
    id: "HABIT_FORMING",
    name: "Habit forming",
    description: "Five swims in the books",
    emoji: "🐬",
    tier: 1,
    metric: "swims",
    goal: 5,
  }),
  ach({
    id: "FIFTY_DIPS",
    name: "Half-century",
    description: "50 swims logged",
    emoji: "🦭",
    tier: 3,
    metric: "swims",
    goal: 50,
  }),
  ach({
    id: "COLLECTOR",
    name: "Spot collector",
    description: "Five unique spots",
    emoji: "📍",
    tier: 1,
    metric: "uniquePlaces",
    goal: 5,
  }),
  ach({
    id: "EXPLORER",
    name: "Explorer",
    description: "Fifteen unique spots",
    emoji: "🗺️",
    tier: 2,
    metric: "uniquePlaces",
    goal: 15,
  }),
  ach({
    id: "POLAR_BEAR",
    name: "Polar bear",
    description: "First winter dip",
    emoji: "❄️",
    tier: 1,
    metric: "winterSwims",
    goal: 1,
  }),
  ach({
    id: "COLD_PURIST",
    name: "Cold purist",
    description: "Five winter dips",
    emoji: "🧊",
    tier: 2,
    metric: "winterSwims",
    goal: 5,
  }),
  ach({
    id: "WINTER_WARRIOR",
    name: "Winter warrior",
    description: "Ten winter dips",
    emoji: "🥶",
    tier: 3,
    metric: "winterSwims",
    goal: 10,
  }),
  ach({
    id: "STREAK_3",
    name: "On a roll",
    description: "Three weeks in a row",
    emoji: "🔥",
    tier: 1,
    metric: "bestWeekStreak",
    goal: 3,
  }),
  ach({
    id: "STREAK_6",
    name: "Unstoppable",
    description: "Six weeks in a row",
    emoji: "🔥",
    tier: 3,
    metric: "bestWeekStreak",
    goal: 6,
  }),
  ach({
    id: "DAY_STREAK_7",
    name: "Week of water",
    description: "Seven days in a row",
    emoji: "🌊",
    tier: 2,
    metric: "bestDayStreak",
    goal: 7,
  }),
  ach({
    id: "DAY_STREAK_30",
    name: "Disco dipper",
    description: "Thirty days in a row",
    emoji: "🪩",
    tier: 3,
    metric: "bestDayStreak",
    goal: 30,
  }),
  ach({
    id: "GLOBETROTTER",
    name: "Globetrotter",
    description: "Spots span 50 km",
    emoji: "🌍",
    tier: 2,
    metric: "rangeKm",
    goal: 50,
  }),
  ach({
    id: "WANDERLUST",
    name: "Wanderlust",
    description: "Spots span 250 km",
    emoji: "✈️",
    tier: 3,
    metric: "rangeKm",
    goal: 250,
  }),
  ach({
    id: "BUDDY_UP",
    name: "Buddy up",
    description: "Share a spot with another swimmer",
    emoji: "🤝",
    tier: 1,
    metric: "maxSharedSwimmers",
    goal: 1,
  }),
  ach({
    id: "SOCIAL_BUTTERFLY",
    name: "Social butterfly",
    description: "Share a spot with 3+ others",
    emoji: "🦋",
    tier: 2,
    metric: "maxSharedSwimmers",
    goal: 3,
  }),
  ach({
    id: "DAWN_PATROL",
    name: "Dawn patrol",
    description: "Three swims before 7 am",
    emoji: "🌅",
    tier: 2,
    metric: "earlySwims",
    goal: 3,
  }),
  ach({
    id: "NIGHT_OWL",
    name: "Night owl",
    description: "Three swims after 8 pm",
    emoji: "🌙",
    tier: 2,
    metric: "lateSwims",
    goal: 3,
  }),
  ach({
    id: "ALL_SEASONS",
    name: "All seasons",
    description: "A dip in winter, spring, summer, autumn",
    emoji: "🍂",
    tier: 2,
    metric: "seasons",
    goal: 4,
  }),
];

export function evaluateAchievements(ctx: AchievementContext): Set<string> {
  const stats = computeAchievementStats(ctx);
  const out = new Set<string>();
  for (const a of ACHIEVEMENTS) if (stats[a.metric] >= a.goal) out.add(a.id);
  return out;
}

export const ACHIEVEMENTS_BY_ID: Record<string, Achievement> =
  Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
