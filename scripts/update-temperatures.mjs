#!/usr/bin/env node
/**
 * Refresh water temperatures for every seeded place.
 *
 *   - Places preferring Hav och Vatten (SE) are read from the `badplatsen`
 *     API first. Most baths have no real-time sensor, so when that returns
 *     nothing we fall back to Open-Meteo.
 *   - Every other place (EEA DK/FI, OSM NO, user-added, or any SE bath
 *     without an official reading) gets its temperature from Open-Meteo's
 *     marine satellite data, keyed on the place's lat/lng.
 *
 * The preferred upstream is the place's `tempSource` field
 * ("havochvatten" | "open-meteo"), falling back to the legacy `source`
 * field for docs seeded before `tempSource` existed. Each updated doc
 * records `waterTempProvider` — which upstream actually produced the
 * reading.
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

// Per-bath detail document. The latest temperature reading is at the
// root level as `sampleTemperature` (string °C) + `sampleDate` (ms).
const TEMP_URL = (nutsCode) =>
  `https://badplatsen.havochvatten.se/badplatsen/api/detail/${encodeURIComponent(nutsCode)}`;

// Open-Meteo's marine model is sea/ocean-only — its grid has no values
// over inland lakes, so a lake coordinate returns null sea_surface_temperature.
// That's expected: lake spots without an official reading just show no temp.
const OPEN_METEO_URL = (lat, lng) =>
  `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&current=sea_surface_temperature`;

// Most sensors only run during summer, so a year-round 14-day filter
// would hide everything off-season. Keep the latest reading regardless
// of age — the popup/tooltip surfaces "X days ago" so users can judge.
const MAX_AGE_DAYS = 365;

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
    // sampleTemperature comes back as a string ("17"); coerce defensively.
    const raw =
      data?.sampleTemperature ??
      data?.value ??
      data?.temperature ??
      data?.celsius;
    const temp = typeof raw === "string" ? Number(raw) : raw;
    if (
      typeof temp !== "number" ||
      Number.isNaN(temp) ||
      temp < -5 ||
      temp > 40
    ) {
      return null;
    }
    const stampRaw =
      data?.sampleDate ?? data?.date ?? data?.timestamp ?? data?.measuredAt;
    // sampleDate is already epoch ms in the badplatsen feed.
    const stamp =
      typeof stampRaw === "number" ? stampRaw : Date.parse(stampRaw ?? "");
    if (!stamp || Number.isNaN(stamp)) return null;
    const ageDays = (Date.now() - stamp) / 86_400_000;
    if (ageDays > MAX_AGE_DAYS) return null;
    return { temp, stamp, provider: "havochvatten" };
  } catch {
    return null;
  }
}

async function fetchOpenMeteo(lat, lng) {
  try {
    const res = await fetch(OPEN_METEO_URL(lat, lng), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const temp = data?.current?.sea_surface_temperature;
    if (
      typeof temp !== "number" ||
      Number.isNaN(temp) ||
      temp < -5 ||
      temp > 40
    ) {
      return null;
    }
    const stamp = data?.current?.time ? Date.parse(data.current.time) : null;
    if (!stamp || Number.isNaN(stamp)) return null;
    return { temp, stamp, provider: "open-meteo" };
  } catch {
    return null;
  }
}

/**
 * Resolve the best reading for a place: official feed first when that's
 * the preferred source, then Open-Meteo as the universal fallback.
 */
async function resolveReading(data) {
  const tempSource =
    data.tempSource ??
    (data.source === "havochvatten.se" ? "havochvatten" : "open-meteo");
  if (tempSource === "havochvatten" && data.externalId) {
    const official = await fetchTemp(data.externalId);
    if (official) return official;
  }
  if (typeof data.lat === "number" && typeof data.lng === "number") {
    return fetchOpenMeteo(data.lat, data.lng);
  }
  return null;
}

async function main() {
  initAdmin();
  const db = getFirestore();

  console.log(`→ project: ${PROJECT_ID}`);
  console.log(`→ mode:    ${WRITE ? "WRITE" : "dry-run (no writes)"}`);

  console.log("→ loading places…");
  // Every place with coordinates is refreshable now — official feed where
  // available, Open-Meteo satellite data otherwise.
  const snap = await db.collection("places").get();
  const seeded = snap.docs.filter((d) => {
    const data = d.data();
    return typeof data.lat === "number" && typeof data.lng === "number";
  });
  console.log(`→ ${seeded.length} places with coordinates`);

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
    const reading = await resolveReading(data);
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
      data.waterTempAt === reading.stamp &&
      data.waterTempProvider === reading.provider
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
        waterTempProvider: reading.provider,
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
        `\n   ✓ ${data.name} → ${reading.temp.toFixed(1)} °C (${reading.provider})\n`,
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
