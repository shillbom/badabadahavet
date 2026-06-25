#!/usr/bin/env node
/**
 * One-time backfill: populate users/{uid}.scores from existing sessions.
 *
 * Scoring moved server-side (the logSession / removeSession Cloud Functions
 * maintain `scores[year]`). Existing users have sessions but no `scores`
 * field yet — this recomputes it from their logged sessions so the
 * leaderboard reads complete, authoritative per-year totals.
 *
 * Run once, right after deploying the new functions + rules:
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/backfill-scores.mjs            # dry-run
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/backfill-scores.mjs --write    # commit
 *
 * Idempotent: it sets each user's full `scores` map from the sum of their
 * sessions' stored `points`, so re-running just rewrites the same values.
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
snap.forEach((d) => {
  const s = d.data();
  if (typeof s.uid !== "string" || typeof s.date !== "number") return;
  const pts = typeof s.points === "number" ? s.points : 0;
  const year = String(swimYear(s.date));
  const scores = byUser.get(s.uid) ?? {};
  scores[year] = (scores[year] ?? 0) + pts;
  byUser.set(s.uid, scores);
});

console.log(
  `Computed scores for ${byUser.size} user(s) from ${snap.size} session(s).`,
);

if (!WRITE) {
  for (const [uid, scores] of byUser) {
    console.log(`  ${uid}: ${JSON.stringify(scores)}`);
  }
  console.log("\nDry run — pass --write to commit.");
  process.exit(0);
}

let updated = 0;
let missing = 0;
for (const [uid, scores] of byUser) {
  const ref = db.collection("users").doc(uid);
  const u = await ref.get();
  if (!u.exists) {
    missing++;
    continue;
  }
  await ref.update({ scores });
  updated++;
}

console.log(
  `Wrote scores to ${updated} user(s); skipped ${missing} (no user doc).`,
);
process.exit(0);
