// Pure scoring helpers for the Cloud Functions — no firebase-admin imports
// so they're trivially unit-testable. Mirror of src/lib/scoring.ts.
//
// Year bucket + winter test use UTC so the server is deterministic. The
// boundary fuzz vs. a browser's local year is a few hours once a year and
// doesn't matter for a swim contest.

export const POINTS_PER_SWIM = 1;
export const POINTS_NEW_SPOT = 3;
export const POINTS_WINTER = 2;

export function swimYear(ts) {
  return new Date(ts).getUTCFullYear();
}

export function isWinterMonth(ts) {
  const m = new Date(ts).getUTCMonth();
  return m === 10 || m === 11 || m === 0 || m === 1 || m === 2;
}

export function yearBounds(year) {
  return [Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1)];
}

/** Points a single swim earns. */
export function swimPoints(isUniqueForUser, isWinter) {
  return (
    POINTS_PER_SWIM +
    (isUniqueForUser ? POINTS_NEW_SPOT : 0) +
    (isWinter ? POINTS_WINTER : 0)
  );
}

/**
 * Sum the points of a user's sessions for a year, optionally excluding one.
 * Takes anything with a Firestore-QuerySnapshot-shaped `forEach` so it can be
 * unit-tested with a plain stub.
 */
export function sumYearPoints(querySnap, excludeId) {
  let total = 0;
  querySnap.forEach((d) => {
    if (excludeId && d.id === excludeId) return;
    const p = d.data().points;
    if (typeof p === "number") total += p;
  });
  return total;
}
