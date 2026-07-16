#!/usr/bin/env node
/**
 * Rebuild `placesSummary/current` — the single doc every client reads for the
 * map's pins, list pickers and search — instead of an always-on listener over
 * the whole (~4k-doc) `places` collection. That listener paid a full
 * cold-collection read per new/guest/cache-evicted client and re-streamed
 * every place edit (and every swim's `lastSwim*` stamp) to every connected
 * client. The summary carries only the lightweight display fields (name,
 * lat/lng, naturist flag) plus the aggregated `lastSwim*` used for the pin's
 * recency glow + border frame; clients pick up spots created or edited since
 * this run via a bounded `updatedAt > builtAt` delta listener on `places`.
 *
 * Mirrors scripts/update-temperatures.mjs: it reuses the same daily GitHub
 * Action + service account, writes with a plain `set` (so deleted places drop
 * out), and only writes when the entries actually changed — so a no-change day
 * costs the clients nothing.
 *
 * The `lastSwim*` aggregate is computed from the `sessions` collection (the
 * most recent swim per place, by `date`, matching logSession/removeSession
 * semantics, incl. back-dated swims). It is read UNBOUNDED on purpose: the
 * pin's border ring shows regardless of age even though the glow fades after
 * ~60 days, so windowing the read would drop long-stale border frames.
 *
 * Usage (local):
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/update-places-summary.mjs           # dry-run
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/update-places-summary.mjs --write   # commit the rebuild
 *
 * The GitHub Action at .github/workflows/temperatures.yml runs this daily,
 * right after the temperature sweep.
 */

import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import {
  buildPlacesSummaryEntries,
  placesSummaryChanged,
} from "../functions/placesLogic.js";

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

/** Most recent swim per place (by `date`) from every session, so the summary
 *  carries the same "last swim here" frame logSession denormalises onto the
 *  place doc — but computed once here instead of stamped on every swim. */
function aggregateLastSwim(sessionDocs) {
  const lastSwim = new Map();
  for (const d of sessionDocs) {
    const s = d.data();
    if (typeof s.date !== "number" || typeof s.placeId !== "string") continue;
    const cur = lastSwim.get(s.placeId);
    if (!cur || s.date > cur.at) {
      lastSwim.set(s.placeId, {
        at: s.date,
        border: typeof s.border === "string" ? s.border : "none",
      });
    }
  }
  return lastSwim;
}

async function main() {
  initAdmin();
  const db = getFirestore();

  console.log(`→ project: ${PROJECT_ID}`);
  console.log(`→ mode:    ${WRITE ? "WRITE" : "dry-run (no writes)"}`);

  // Capture the build cursor BEFORE reading, so the client's delta window
  // (updatedAt > builtAt) overlaps the build rather than leaving a gap — a
  // doc edited mid-build is simply re-read by the delta, and the client merge
  // is idempotent.
  const builtAt = Date.now();

  console.log("→ loading places + sessions…");
  const summaryRef = db.collection("placesSummary").doc("current");
  const [placeSnap, sessionSnap, summarySnap] = await Promise.all([
    db.collection("places").get(),
    db.collection("sessions").get(),
    summaryRef.get(),
  ]);

  const lastSwim = aggregateLastSwim(sessionSnap.docs);

  const places = placeSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      name: data.name,
      lat: data.lat,
      lng: data.lng,
      nude: data.nude,
    };
  });

  const oldEntries = summarySnap.exists
    ? (summarySnap.data().entries ?? {})
    : {};
  const newEntries = buildPlacesSummaryEntries(places, lastSwim);
  const entryCount = Object.keys(newEntries).length;
  const bytes = JSON.stringify(newEntries).length;
  const kib = (bytes / 1024).toFixed(0);
  console.log(
    `→ ${placeSnap.size} place docs, ${sessionSnap.size} sessions, ` +
      `${lastSwim.size} with a last swim`,
  );
  console.log(
    `→ summary: ${entryCount} entries, ~${kib} KiB serialized ` +
      `(1 MiB doc limit; shard if it exceeds ~700 KiB)`,
  );

  if (!placesSummaryChanged(oldEntries, newEntries)) {
    console.log(`→ placesSummary/current unchanged — nothing to write`);
  } else if (WRITE) {
    await summaryRef.set({ builtAt, entries: newEntries });
    console.log(`✓ placesSummary/current rewritten (${entryCount} entries)`);
  } else {
    console.log(
      `→ dry-run: placesSummary/current would be rewritten ` +
        `(${entryCount} entries) — run again with --write to commit`,
    );
  }
}

main().catch((e) => {
  console.error("✗", e);
  process.exit(1);
});
