// Pure helpers for the world-readable global leaderboard snapshot
// (`leaderboard/{year}`). No firebase-admin imports so they're trivially
// unit-testable. The snapshot holds only the top N entries so guests — who
// can't read user docs (rules) — still get a global board, and so scoring
// only has to compare a swimmer against those N when their score changes.
//
// Incremental updates are best-effort: a score that *increases* is always
// placed correctly, but a score that *drops* (edit/removal) can leave a
// stale slot because the 6th-place swimmer isn't tracked. The per-year
// backfill job (scripts/backfill-toplist.mjs) is the source of truth and
// self-heals any drift.

export const LEADERBOARD_TOP_N = 5;

/**
 * Build a snapshot entry from a user doc's data. Optional fields are omitted
 * when absent so the stored doc stays lean (Firestore rejects `undefined`).
 */
export function leaderboardEntry(uid, user, points, stats) {
  const entry = {
    uid,
    displayName: (user && user.displayName) || "Swimmer",
    points,
    stats: stats ?? null,
  };
  if (user && user.selectedBorder) entry.selectedBorder = user.selectedBorder;
  if (user && user.achievements) entry.achievements = user.achievements;
  return entry;
}

/**
 * Upsert `entry` into the current top list and return the new top N. Removes
 * any existing entry for the same uid first, only keeps swimmers with a
 * positive score, and sorts by points desc with a stable uid tie-break.
 */
export function applyToTop(top, entry, n = LEADERBOARD_TOP_N) {
  const list = Array.isArray(top)
    ? top.filter((e) => e && e.uid !== entry.uid)
    : [];
  if (typeof entry.points === "number" && entry.points > 0) list.push(entry);
  list.sort(
    (a, b) => b.points - a.points || String(a.uid).localeCompare(String(b.uid)),
  );
  return list.slice(0, n);
}

/** Drop a swimmer from the top list (account deletion / ban). */
export function removeFromTop(top, uid, n = LEADERBOARD_TOP_N) {
  const list = Array.isArray(top) ? top.filter((e) => e && e.uid !== uid) : [];
  return list.slice(0, n);
}
