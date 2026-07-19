import { FIRST_YEAR } from "./scoring";

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
