#!/usr/bin/env node
/**
 * One-time / re-runnable backfill from existing sessions. Two jobs:
 *
 *   1. users/{uid}.scores  — per-year point totals (the score moved
 *      server-side; the leaderboard reads these). Recomputed from each
 *      user's sessions' stored `points`.
 *
 *   2. places/{id}.lastSwim* — the most recent swim at each place and that
 *      swimmer's border frame, so the map can outline each pin with the
 *      last swimmer's frame. (Live logSession/removeSession maintain this
 *      going forward; this seeds it for places that existed before.)
 *
 * Idempotent — safe to re-run; it overwrites with freshly-computed values.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/backfill-scores.mjs            # dry-run
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/backfill-scores.mjs --write    # commit
 */
import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const WRITE = process.argv.includes("--write");
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "badligan";

function initAdmin() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    return initializeApp({
      credential: cert(JSON.parse(readFileSync(credPath, "utf8"))),
      projectId: PROJECT_ID,
    });
  }
  return initializeApp({
    credential: applicationDefault(),
    projectId: PROJECT_ID,
  });
}

// Year bucket must match the Cloud Functions (UTC).
function swimYear(ts) {
  return new Date(ts).getUTCFullYear();
}

const app = initAdmin();
const db = getFirestore(app);

const snap = await db.collection("sessions").get();

const byUser = new Map(); // uid -> { [year]: points }
const lastByPlace = new Map(); // placeId -> { date, uid, border|null }
snap.forEach((d) => {
  const s = d.data();
  if (typeof s.uid !== "string" || typeof s.date !== "number") return;

  // (1) yearly score
  const pts = typeof s.points === "number" ? s.points : 0;
  const year = String(swimYear(s.date));
  const scores = byUser.get(s.uid) ?? {};
  scores[year] = (scores[year] ?? 0) + pts;
  byUser.set(s.uid, scores);

  // (2) most recent swim per place
  if (typeof s.placeId === "string") {
    const cur = lastByPlace.get(s.placeId);
    if (!cur || s.date > cur.date) {
      lastByPlace.set(s.placeId, {
        date: s.date,
        uid: s.uid,
        border: typeof s.border === "string" ? s.border : null,
      });
    }
  }
});

// Fallback frame for places whose latest session predates the `border`
// field: that swimmer's currently-chosen border. (Live logSession stores
// the fully-resolved frame, so this only matters for old swims.)
const usersSnap = await db.collection("users").get();
const borderByUser = new Map();
const userExists = new Set();
usersSnap.forEach((u) => {
  userExists.add(u.id);
  const b = u.data().selectedBorder;
  if (typeof b === "string") borderByUser.set(u.id, b);
});

// Only stamp places that still exist (a session can outlive its place).
const placesSnap = await db.collection("places").get();
const placeExists = new Set(placesSnap.docs.map((p) => p.id));

console.log(
  `From ${snap.size} session(s): scores for ${byUser.size} user(s), ` +
    `last-swim for ${[...lastByPlace.keys()].filter((id) => placeExists.has(id)).length} place(s).`,
);

if (!WRITE) {
  console.log("\nDry run — pass --write to commit.");
  process.exit(0);
}

let scored = 0;
let missingUsers = 0;
for (const [uid, scores] of byUser) {
  if (!userExists.has(uid)) {
    missingUsers++;
    continue;
  }
  await db.collection("users").doc(uid).update({ scores });
  scored++;
}

let stamped = 0;
for (const [placeId, last] of lastByPlace) {
  if (!placeExists.has(placeId)) continue;
  const border = last.border ?? borderByUser.get(last.uid) ?? "none";
  await db.collection("places").doc(placeId).update({
    lastSwimAt: last.date,
    lastSwimBy: last.uid,
    lastSwimBorder: border,
  });
  stamped++;
}

console.log(
  `Wrote scores to ${scored} user(s) (skipped ${missingUsers} missing); ` +
    `stamped ${stamped} place(s).`,
);
process.exit(0);
