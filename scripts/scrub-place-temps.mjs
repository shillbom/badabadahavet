#!/usr/bin/env node
/**
 * One-off migration: delete the legacy temperature fields (waterTemp,
 * waterTempAt, waterTempProvider, waterTempCheckedAt) from every place doc.
 * Readings live in tempSummary/current + placeTemps/{placeId} now; the
 * legacy fields only serve old cached PWA clients during the transition.
 *
 * Run this once the transition window has passed (~30 days, so cached
 * clients have rolled over). Each touched doc fans out one read to every
 * client subscribed to `places` at that moment, so prefer an off-peak hour
 * — in exchange every future cold load of the collection is permanently
 * smaller.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/scrub-place-temps.mjs           # dry-run
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/scrub-place-temps.mjs --write   # commit deletes
 */

import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const WRITE = process.argv.includes("--write");
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "badligan";

const LEGACY_FIELDS = [
  "waterTemp",
  "waterTempAt",
  "waterTempProvider",
  "waterTempCheckedAt",
];

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

async function main() {
  initAdmin();
  const db = getFirestore();

  console.log(`→ project: ${PROJECT_ID}`);
  console.log(`→ mode:    ${WRITE ? "WRITE" : "dry-run (no writes)"}`);

  const snap = await db.collection("places").get();
  const stale = snap.docs.filter((d) => {
    const data = d.data();
    return LEGACY_FIELDS.some((f) => f in data);
  });
  console.log(
    `→ ${snap.size} places, ${stale.length} still carry legacy temp fields`,
  );

  if (!WRITE || stale.length === 0) {
    if (stale.length > 0)
      console.log(`run again with --write to scrub ${stale.length} docs.`);
    return;
  }

  const updates = Object.fromEntries(
    LEGACY_FIELDS.map((f) => [f, FieldValue.delete()]),
  );
  let batch = db.batch();
  let inBatch = 0;
  let done = 0;
  for (const doc of stale) {
    batch.update(doc.ref, updates);
    inBatch++;
    done++;
    if (inBatch >= 400) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
      console.log(`→ ${done}/${stale.length}`);
    }
  }
  if (inBatch > 0) await batch.commit();
  console.log(`✓ scrubbed ${done} docs.`);
}

main().catch((e) => {
  console.error("✗", e);
  process.exit(1);
});
