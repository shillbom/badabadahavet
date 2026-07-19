#!/usr/bin/env node
/**
 * Rebuild the global leaderboard snapshot from scratch, one doc per year:
 *
 *   leaderboard/{year} = { year, top: Entry[<=5], updatedAt }
 *
 * This is the source of truth for the world-readable global board that
 * signed-out guests see. The logSession / removeSession / editSession Cloud
 * Functions keep each year's top 5 up to date incrementally, but score
 * *drops* (edits, removals, bans) can leave a stale slot because the 6th
 * swimmer isn't tracked. Run this job to heal that drift — it recomputes the
 * top 5 for every year straight from the users' denormalised `scores` and
 * `statsByYear` (produced by scripts/backfill-scores.mjs).
 *
 * Idempotent — safe to re-run.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/backfill-toplist.mjs            # dry-run
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/backfill-toplist.mjs --write    # commit
 */
import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const WRITE = process.argv.includes("--write");
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "badligan";
const TOP_N = 5;

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

// Mirrors functions/leaderboard.js#leaderboardEntry — omit absent optionals
// so Firestore never sees `undefined`.
function leaderboardEntry(uid, user, points, stats) {
  const entry = {
    uid,
    displayName: user.displayName || "Swimmer",
    points,
    stats: stats ?? null,
  };
  if (user.selectedBorder) entry.selectedBorder = user.selectedBorder;
  if (user.achievements) entry.achievements = user.achievements;
  return entry;
}

const app = initAdmin();
const db = getFirestore(app);

const usersSnap = await db.collection("users").get();

// year -> Entry[]
const byYear = new Map();
usersSnap.forEach((doc) => {
  const user = doc.data();
  const scores = user.scores;
  if (!scores || typeof scores !== "object") return;
  const statsByYear = user.statsByYear ?? {};
  for (const [year, points] of Object.entries(scores)) {
    if (typeof points !== "number" || points <= 0) continue;
    const entries = byYear.get(year) ?? [];
    entries.push(
      leaderboardEntry(doc.id, user, points, statsByYear[year] ?? null),
    );
    byYear.set(year, entries);
  }
});

const plan = [];
for (const [year, entries] of byYear) {
  // Same ordering the Cloud Functions apply: points desc, uid asc tie-break.
  entries.sort(
    (a, b) => b.points - a.points || String(a.uid).localeCompare(String(b.uid)),
  );
  plan.push({ year, top: entries.slice(0, TOP_N) });
}
plan.sort((a, b) => Number(a.year) - Number(b.year));

console.log(
  `From ${usersSnap.size} user(s): top ${TOP_N} for ${plan.length} year(s).`,
);
for (const { year, top } of plan) {
  const line = top
    .map((e, i) => `${i + 1}. ${e.displayName} (${e.points})`)
    .join(", ");
  console.log(`  ${year}: ${line}`);
}

if (!WRITE) {
  console.log("\nDry run — pass --write to commit.");
  process.exit(0);
}

let written = 0;
for (const { year, top } of plan) {
  await db
    .collection("leaderboard")
    .doc(String(year))
    .set({ year: Number(year), top, updatedAt: Date.now() });
  written++;
}

console.log(`Wrote ${written} leaderboard snapshot(s).`);
process.exit(0);
