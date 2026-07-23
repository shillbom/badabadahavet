import { FIRST_YEAR } from "./scoring";
import { longestStreakInYear } from "./streak";
import type { SessionDoc } from "./types";

/** How a group board / member list is ordered. */
export type MemberSortBy = "points" | "recent" | "streak";

/** Aggregated per-member competition stats derived from a set of sessions. */
export type MemberStat = {
  points: number;
  swims: number;
  spots: Set<string>;
  lastSwim: number;
  streak: number;
};

/**
 * Aggregate per-member competition stats from a set of sessions. Every uid in
 * `members` is seeded with a zeroed entry so absent members still rank (at 0),
 * and sessions from non-members are ignored. `streakYear` is the calendar year
 * used for the "longest streak" metric — the year's best run, not the live one,
 * so a broken streak today doesn't unfairly sink a member; for a timespan that
 * crosses years pass the year the range mostly falls in.
 */
export function aggregateMemberStats(
  sessions: SessionDoc[],
  members: string[],
  streakYear: number,
): Map<string, MemberStat> {
  const memberSet = new Set(members);
  const acc = new Map<
    string,
    {
      points: number;
      swims: number;
      spots: Set<string>;
      lastSwim: number;
      dates: number[];
    }
  >();
  for (const uid of members)
    acc.set(uid, {
      points: 0,
      swims: 0,
      spots: new Set(),
      lastSwim: 0,
      dates: [],
    });
  for (const s of sessions) {
    if (!memberSet.has(s.uid)) continue;
    const entry = acc.get(s.uid)!;
    entry.points += s.points;
    entry.swims += 1;
    entry.spots.add(s.placeId);
    if (s.date > entry.lastSwim) entry.lastSwim = s.date;
    entry.dates.push(s.date);
  }
  const map = new Map<string, MemberStat>();
  for (const [uid, e] of acc)
    map.set(uid, {
      points: e.points,
      swims: e.swims,
      spots: e.spots,
      lastSwim: e.lastSwim,
      streak: longestStreakInYear(e.dates, streakYear),
    });
  return map;
}

/**
 * Compare two members' stats for the given sort. Returns a value suitable for
 * `Array.prototype.sort` where the *higher-ranked* member sorts first
 * (descending points / recency / streak). Undefined stats rank last.
 */
export function compareMemberStats(
  a: MemberStat | undefined,
  b: MemberStat | undefined,
  sortBy: MemberSortBy,
): number {
  if (sortBy === "recent") return (b?.lastSwim ?? 0) - (a?.lastSwim ?? 0);
  if (sortBy === "streak")
    return (
      (b?.streak ?? 0) - (a?.streak ?? 0) ||
      (b?.lastSwim ?? 0) - (a?.lastSwim ?? 0)
    );
  return (b?.points ?? 0) - (a?.points ?? 0);
}

/**
 * Slice a ranked list down to the podium view: the top N rows, plus the
 * caller's own row (with its true rank) when it exists further down.
 * `me` is null when the caller is unranked, not signed in, or already
 * inside the top N — callers render nothing extra in those cases.
 */
export function splitTopList<T extends { uid: string }>(
  rows: T[],
  myUid: string | undefined,
  topN: number,
): { top: T[]; me: { row: T; rank: number } | null } {
  const top = rows.slice(0, topN);
  if (!myUid) return { top, me: null };
  const rank = rows.findIndex((r) => r.uid === myUid);
  if (rank < topN) return { top, me: null }; // -1 (unranked) lands here too
  return { top, me: { row: rows[rank], rank } };
}

/**
 * Bounds for the leaderboard's season picker. The floor is {@link FIRST_YEAR}
 * (the first season the app was live) and the ceiling is the current season, so
 * you can page back through finished seasons but never before the app existed
 * or into a season that hasn't started. `canGoBack`/`canGoForward` drive the
 * arrows, which disable at the respective bound.
 */
export function yearPickerBounds(
  selectedYear: number,
  currentYear: number,
): { min: number; max: number; canGoBack: boolean; canGoForward: boolean } {
  const min = FIRST_YEAR;
  const max = Math.max(currentYear, FIRST_YEAR);
  return {
    min,
    max,
    canGoBack: selectedYear > min,
    canGoForward: selectedYear < max,
  };
}
