#!/usr/bin/env node
/**
 * One-time / re-runnable backfill from existing sessions:
 *
 *   users/{uid}.scores + users/{uid}.statsByYear — per-year point totals
 *   and leaderboard card stats (swims / new spots / winters / countries
 *   abroad). The leaderboard reads both straight off the user doc.
 *   Recomputed from each user's sessions' stored fields.
 *
 * (The map's per-place "last swim" frame is no longer stored on place docs —
 * the daily placesSummary build derives it from sessions.)
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
const statsByUser = new Map(); // uid -> { [year]: {swims,uniquePlaces,winters,abroad:Set} }
snap.forEach((d) => {
  const s = d.data();
  if (typeof s.uid !== "string" || typeof s.date !== "number") return;

  // yearly score + leaderboard card stats
  const pts = typeof s.points === "number" ? s.points : 0;
  const year = String(swimYear(s.date));
  const scores = byUser.get(s.uid) ?? {};
  scores[year] = (scores[year] ?? 0) + pts;
  byUser.set(s.uid, scores);

  const years = statsByUser.get(s.uid) ?? {};
  const st = (years[year] ??= {
    swims: 0,
    uniquePlaces: 0,
    winters: 0,
    abroad: new Set(),
  });
  st.swims++;
  if (s.isUniqueForUser) st.uniquePlaces++;
  if (s.isWinter) st.winters++;
  if (!s.isHomeCountry && typeof s.country === "string" && s.country) {
    st.abroad.add(s.country);
  }
  statsByUser.set(s.uid, years);
});

// Which users still exist (a session can outlive its user).
const usersSnap = await db.collection("users").get();
const userExists = new Set();
usersSnap.forEach((u) => userExists.add(u.id));

console.log(`From ${snap.size} session(s): scores for ${byUser.size} user(s).`);

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
  const statsByYear = {};
  for (const [year, st] of Object.entries(statsByUser.get(uid) ?? {})) {
    statsByYear[year] = {
      swims: st.swims,
      uniquePlaces: st.uniquePlaces,
      winters: st.winters,
      countriesAbroad: st.abroad.size,
    };
  }
  await db.collection("users").doc(uid).update({ scores, statsByYear });
  scored++;
}

console.log(
  `Wrote scores to ${scored} user(s) (skipped ${missingUsers} missing).`,
);
process.exit(0);
