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
