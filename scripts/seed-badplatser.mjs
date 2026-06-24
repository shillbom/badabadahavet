#!/usr/bin/env node
/**
 * Seed places from the Hav och Vatten "Badplatsen" open dataset.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/seed-badplatser.mjs           # dry run (no writes)
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/seed-badplatser.mjs --write   # actually write
 *
 * Notes:
 *   - Requires `firebase-admin` (devDep) and a service-account JSON.
 *   - Idempotent: skips any place whose (name, lat-rounded, lng-rounded)
 *     already exists in Firestore, so re-running won't duplicate.
 *   - Writes in chunks of 400 to stay safely below the 500-op batch limit.
 *   - Each seeded doc gets `seeded: true`, `source: "havochvatten.se"`,
 *     and `createdBy: "system:badplatsen"` so they're distinguishable
 *     and the per-user rename rule keeps regular users out.
 */

import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const WRITE = process.argv.includes("--write");
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "badligan";

// The Havochvatten "Badplatsen" feature API. Returns FeatureCollection
// in EPSG:4326 (WGS84) with `name` plus a numeric `nutsCode` per spot.
// If they ever change the URL, swap it here.
const FEED_URL =
  "https://badplatsen.havochvatten.se/badplatsen/api/feature?json=" +
  encodeURIComponent(
    JSON.stringify({
      objects: ["bath"],
      detail: true,
    }),
  );

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

async function fetchBadplatser() {
  console.log(`→ fetching ${FEED_URL}`);
  const res = await fetch(FEED_URL, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`feed responded ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  // Accept either { features: [...] } GeoJSON or a flat array.
  const raw = Array.isArray(data)
    ? data
    : (data.features ?? data.objects ?? []);
  const places = [];
  for (const item of raw) {
    const place = normalize(item);
    if (place) places.push(place);
  }
  return places;
}

function normalize(item) {
  // Hav och Vatten returns Swedish-cased properties; we still accept
  // lower-cased / English keys so a future API revamp doesn't break us.
  const props = item.properties ?? item;
  const name = props.NAMN ?? props.name ?? props.title;
  let lat, lng;
  if (item.geometry?.type === "Point") {
    [lng, lat] = item.geometry.coordinates ?? [];
  } else if (typeof props.lat === "number" && typeof props.lng === "number") {
    lat = props.lat;
    lng = props.lng;
  } else if (
    typeof props.latitude === "number" &&
    typeof props.longitude === "number"
  ) {
    lat = props.latitude;
    lng = props.longitude;
  }
  const externalId =
    props.NUTSKOD ??
    props.nutsCode ??
    props.id ??
    props.bathId ??
    item.id ??
    null;
  if (!name || typeof lat !== "number" || typeof lng !== "number") return null;
  return {
    name: name.toString().trim().slice(0, 80),
    lat,
    lng,
    externalId: externalId ? String(externalId) : null,
  };
}

function dedupKey(p) {
  // Same name within ~10 m counts as a duplicate.
  return `${p.name.toLowerCase()}|${p.lat.toFixed(4)}|${p.lng.toFixed(4)}`;
}

async function main() {
  initAdmin();
  const db = getFirestore();

  console.log(`→ project: ${PROJECT_ID}`);
  console.log(`→ mode:    ${WRITE ? "WRITE" : "dry-run (no writes)"}`);

  const places = await fetchBadplatser();
  console.log(`→ parsed ${places.length} places from feed`);
  if (places.length === 0) {
    console.error("✗ no places parsed — check the FEED_URL and response shape");
    process.exit(1);
  }

  console.log("→ loading existing places from Firestore for dedup…");
  const existingSnap = await db.collection("places").get();
  const existingKeys = new Set();
  for (const doc of existingSnap.docs) {
    const data = doc.data();
    existingKeys.add(
      `${(data.name ?? "").toLowerCase()}|${(data.lat ?? 0).toFixed(4)}|${(data.lng ?? 0).toFixed(4)}`,
    );
  }
  console.log(`→ ${existingKeys.size} existing places loaded`);

  const fresh = places.filter((p) => !existingKeys.has(dedupKey(p)));
  console.log(
    `→ ${fresh.length} new places to insert (${places.length - fresh.length} duplicates skipped)`,
  );

  if (!WRITE) {
    console.log("\nsample (first 5):");
    for (const p of fresh.slice(0, 5)) console.log("   ", p);
    console.log(`\nrun again with --write to commit ${fresh.length} docs.`);
    return;
  }

  let written = 0;
  const now = Date.now();
  const chunkSize = 400;
  for (let i = 0; i < fresh.length; i += chunkSize) {
    const chunk = fresh.slice(i, i + chunkSize);
    const batch = db.batch();
    for (const p of chunk) {
      const ref = db.collection("places").doc();
      batch.set(ref, {
        id: ref.id,
        name: p.name,
        lat: p.lat,
        lng: p.lng,
        createdBy: "system:badplatsen",
        firstSwumAt: now,
        seeded: true,
        source: "havochvatten.se",
        // Prefer the official SE feed; the refresh function falls back to
        // Open-Meteo when Hav och Vatten has no reading for this spot.
        tempSource: "havochvatten",
        ...(p.externalId ? { externalId: p.externalId } : {}),
      });
    }
    await batch.commit();
    written += chunk.length;
    process.stdout.write(`\r→ wrote ${written}/${fresh.length}`);
  }
  console.log("\n✓ done");
}

main().catch((e) => {
  console.error("✗", e);
  process.exit(1);
});
