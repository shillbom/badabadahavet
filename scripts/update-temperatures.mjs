#!/usr/bin/env node
/**
 * Pull recent water-temperature measurements from Hav och Vatten and
 * update every seeded place. Most baths don't have real-time sensors,
 * so we silently skip the ones with no current reading.
 *
 * Usage (local):
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/update-temperatures.mjs           # dry-run
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/update-temperatures.mjs --write   # commit updates
 *
 * The GitHub Action at .github/workflows/temperatures.yml runs this
 * on a schedule.
 */

import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const WRITE = process.argv.includes("--write");
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "badligan";

// Endpoint that returns the latest water-temperature measurement for a
// single bath. Returns `null` / 404 when no measurement exists.
const TEMP_URL = (nutsCode) =>
  `https://badplatsen.havochvatten.se/badplatsen/api/detail/${encodeURIComponent(nutsCode)}/watertemperature`;

// Ignore readings older than this many days — keeps the map honest.
const MAX_AGE_DAYS = 14;

// Small pause between requests so we don't hammer the API.
const REQUEST_DELAY_MS = 100;

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTemp(nutsCode) {
  try {
    const res = await fetch(TEMP_URL(nutsCode), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    // The endpoint shape varies — accept any of {value/temperature, sampleDate/date/timestamp}.
    const temp =
      typeof data?.value === "number"
        ? data.value
        : typeof data?.temperature === "number"
          ? data.temperature
          : typeof data?.celsius === "number"
            ? data.celsius
            : null;
    const stampRaw =
      data?.sampleDate ?? data?.date ?? data?.timestamp ?? data?.measuredAt;
    if (typeof temp !== "number" || temp < -5 || temp > 40) return null;
    const stamp = stampRaw ? Date.parse(stampRaw) : Date.now();
    if (Number.isNaN(stamp)) return null;
    const ageDays = (Date.now() - stamp) / 86_400_000;
    if (ageDays > MAX_AGE_DAYS) return null;
    return { temp, stamp };
  } catch {
    return null;
  }
}

async function main() {
  initAdmin();
  const db = getFirestore();

  console.log(`→ project: ${PROJECT_ID}`);
  console.log(`→ mode:    ${WRITE ? "WRITE" : "dry-run (no writes)"}`);

  console.log("→ loading seeded places…");
  const snap = await db
    .collection("places")
    .where("seeded", "==", true)
    .get();
  const seeded = snap.docs.filter((d) => d.data().externalId);
  console.log(`→ ${seeded.length} seeded places with externalId`);

  let updated = 0;
  let skipped = 0;
  let noTemp = 0;
  let processed = 0;
  let batch = db.batch();
  let inBatch = 0;

  const tty = process.stdout.isTTY;
  const writeProgress = () => {
    const line = `→ ${processed}/${seeded.length} (${updated} updated, ${skipped} unchanged, ${noTemp} no data)`;
    if (tty) {
      process.stdout.clearLine?.(0);
      process.stdout.cursorTo?.(0);
      process.stdout.write(line);
    } else if (processed % 25 === 0 || processed === seeded.length) {
      // Non-interactive (CI) — log every 25 to keep the action log useful.
      console.log(line);
    }
  };

  console.log("→ starting…");
  for (const doc of seeded) {
    const data = doc.data();
    const reading = await fetchTemp(data.externalId);
    processed++;
    if (!reading) {
      noTemp++;
      writeProgress();
      await sleep(REQUEST_DELAY_MS);
      continue;
    }
    // Skip if the stored reading is already the same and recent.
    if (
      data.waterTemp === reading.temp &&
      data.waterTempAt === reading.stamp
    ) {
      skipped++;
      writeProgress();
      await sleep(REQUEST_DELAY_MS);
      continue;
    }
    if (WRITE) {
      batch.update(doc.ref, {
        waterTemp: reading.temp,
        waterTempAt: reading.stamp,
      });
      inBatch++;
      if (inBatch >= 400) {
        await batch.commit();
        batch = db.batch();
        inBatch = 0;
      }
    }
    updated++;
    writeProgress();
    if (tty) {
      // Per-update detail line above the progress bar so the user sees
      // *something* happening, especially when most calls return no data.
      process.stdout.write(
        `\n   ✓ ${data.name} → ${reading.temp.toFixed(1)} °C\n`,
      );
    }
    await sleep(REQUEST_DELAY_MS);
  }
  if (WRITE && inBatch > 0) await batch.commit();
  console.log(
    `\n✓ done — ${updated} updated, ${skipped} unchanged, ${noTemp} without data (of ${seeded.length})`,
  );
  if (!WRITE && updated > 0) {
    console.log(`run again with --write to commit ${updated} updates.`);
  }
}

main().catch((e) => {
  console.error("✗", e);
  process.exit(1);
});
