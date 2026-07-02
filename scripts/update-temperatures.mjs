#!/usr/bin/env node
/**
 * Refresh water temperatures for every seeded place.
 *
 *   - Places preferring Hav och Vatten (SE) are read from the `badplatsen`
 *     API first. Most baths have no real-time sensor, so when that returns
 *     nothing (or something stale) we also try the nearest SMHI ocean
 *     observation station before falling back to Open-Meteo.
 *   - Places preferring SMHI are read from the nearest SMHI ocean
 *     observation station's sea temperature sensor first.
 *   - Every other place (EEA DK/FI, OSM NO, user-added, or any place
 *     without a fresh official reading) gets its temperature from
 *     Open-Meteo's marine satellite data, keyed on the place's lat/lng.
 *
 * The preferred upstream is the place's `tempSource` field
 * ("havochvatten" | "smhi" | "open-meteo"), falling back to the legacy
 * `source` field for docs seeded before `tempSource` existed. Each updated
 * doc records `waterTempProvider` — which upstream actually produced the
 * reading, using that reading's own measurement date (never the time we
 * happened to fetch it).
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

// The app (SwimMap / SpotPage) only *displays* temps younger than a week.
// When an official reading is older than this we prefer Open-Meteo so the
// spot keeps showing a fresh temp. Keep in sync with WEEK_MS in the app.
const FRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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

// SMHI's open oceanographic data has a "Havstemperatur" (sea water
// temperature) parameter, but we resolve its numeric id dynamically
// instead of hardcoding one — SMHI's ids aren't documented as stable, and
// getting it wrong silently returns *some other* quantity that can still
// look like a plausible temperature (this bit us once: a hardcoded wrong
// id quietly reported a winter reading in July). There's also no
// per-place station id, so the nearest active station to a place's
// coordinates is resolved on the fly too.
const SMHI_PARAMETER_LIST_URL =
  "https://opendata-download-ocobs.smhi.se/api/version/1.0.json";
const SMHI_STATIONS_URL = (parameterId) =>
  `https://opendata-download-ocobs.smhi.se/api/version/1.0/parameter/${parameterId}.json`;
const SMHI_DATA_URL = (parameterId, stationId) =>
  `https://opendata-download-ocobs.smhi.se/api/version/1.0/parameter/${parameterId}/station/${stationId}/period/latest-hour/data.json`;

// Don't match a place to a station further away than this — a spot with no
// nearby sensor should just get no SMHI reading rather than a bogus one.
const MAX_SMHI_STATION_DISTANCE_M = 40_000;

let smhiParameterId; // undefined = not yet resolved, null = not found
let smhiStations = null; // cached for the life of this run

function haversineMeters(a, b) {
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

async function findSmhiTempParameterId() {
  if (smhiParameterId !== undefined) return smhiParameterId;
  try {
    const res = await fetch(SMHI_PARAMETER_LIST_URL, {
      headers: { Accept: "application/json" },
    });
    const data = res.ok ? await res.json() : null;
    const match = (data?.resource ?? []).find((r) =>
      String(r.title ?? "")
        .toLowerCase()
        .includes("havstemperatur"),
    );
    smhiParameterId = match?.key ?? null;
  } catch {
    smhiParameterId = null;
  }
  return smhiParameterId;
}

async function fetchSmhiStations(parameterId) {
  if (smhiStations) return smhiStations;
  try {
    const res = await fetch(SMHI_STATIONS_URL(parameterId), {
      headers: { Accept: "application/json" },
    });
    smhiStations = res.ok
      ? ((await res.json())?.station
          ?.filter((s) => s.active !== false)
          .map((s) => ({ id: s.id, lat: s.latitude, lng: s.longitude }))
          .filter(
            (s) =>
              s.id != null &&
              typeof s.lat === "number" &&
              typeof s.lng === "number",
          ) ?? [])
      : [];
  } catch {
    smhiStations = [];
  }
  return smhiStations;
}

async function findNearestSmhiStation(parameterId, lat, lng) {
  const stations = await fetchSmhiStations(parameterId);
  let best = null;
  let bestDist = Infinity;
  for (const s of stations) {
    const dist = haversineMeters({ lat, lng }, s);
    if (dist < bestDist) {
      best = s;
      bestDist = dist;
    }
  }
  return best && bestDist <= MAX_SMHI_STATION_DISTANCE_M ? best.id : null;
}

async function fetchSmhi(lat, lng) {
  try {
    const parameterId = await findSmhiTempParameterId();
    if (parameterId == null) return null;
    const stationId = await findNearestSmhiStation(parameterId, lat, lng);
    if (stationId == null) return null;
    const res = await fetch(SMHI_DATA_URL(parameterId, stationId), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const values = Array.isArray(data?.value) ? data.value : [];
    if (!values.length) return null;
    // Don't assume ordering — take the most recent sample's own
    // timestamp, never "now" (the fetch time).
    const latest = values.reduce((a, b) => (b.date > a.date ? b : a));
    const raw = latest.value;
    const temp = typeof raw === "string" ? Number(raw) : raw;
    const stamp = latest.date;
    if (
      typeof temp !== "number" ||
      Number.isNaN(temp) ||
      temp < -5 ||
      temp > 40 ||
      typeof stamp !== "number" ||
      Number.isNaN(stamp)
    ) {
      return null;
    }
    return { temp, stamp, provider: "smhi" };
  } catch {
    return null;
  }
}

/**
 * Resolve the best reading for a place. A *fresh* official reading wins
 * (it's a real measured water temp); but the app only displays temps
 * younger than a week, so when the official sample is missing or stale we
 * fall back to Open-Meteo (always "now") to keep the spot showing a temp.
 * Inland lakes get nothing from Open-Meteo, so a stale official reading is
 * still returned as a last resort.
 */
async function resolveReading(data) {
  const tempSource =
    data.tempSource ??
    (data.source === "havochvatten.se" ? "havochvatten" : "open-meteo");
  let official = null;
  if (tempSource === "havochvatten" && data.externalId) {
    official = await fetchTemp(data.externalId);
  }
  // Hav och Vatten baths often have no live sensor, so when that comes
  // back empty (or stale) also try the nearest SMHI station before
  // falling back to Open-Meteo — whichever official reading is more
  // recent wins.
  const wantsSmhi =
    tempSource === "smhi" ||
    (tempSource === "havochvatten" &&
      (!official || Date.now() - official.stamp > FRESH_WINDOW_MS));
  if (
    wantsSmhi &&
    typeof data.lat === "number" &&
    typeof data.lng === "number"
  ) {
    const smhi = await fetchSmhi(data.lat, data.lng);
    if (smhi && (!official || smhi.stamp > official.stamp)) {
      official = smhi;
    }
  }
  let reading =
    official && Date.now() - official.stamp <= FRESH_WINDOW_MS
      ? official
      : null;
  if (
    !reading &&
    typeof data.lat === "number" &&
    typeof data.lng === "number"
  ) {
    reading = await fetchOpenMeteo(data.lat, data.lng);
  }
  if (!reading) reading = official; // stale official (or null) as last resort
  if (!reading) return null;

  // Hav och Vatten had nothing (or nothing fresh) and SMHI actually
  // supplied the reading — prefer SMHI going forward instead of paying
  // for a Hav och Vatten call that keeps coming back empty.
  if (tempSource === "havochvatten" && reading.provider === "smhi") {
    return { ...reading, promoteTempSource: "smhi" };
  }
  return reading;
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
    // Skip if the stored reading is already the same and recent, and no
    // tempSource promotion is pending.
    if (
      data.waterTemp === reading.temp &&
      data.waterTempAt === reading.stamp &&
      data.waterTempProvider === reading.provider &&
      (!reading.promoteTempSource ||
        data.tempSource === reading.promoteTempSource)
    ) {
      skipped++;
      writeProgress();
      await sleep(REQUEST_DELAY_MS);
      continue;
    }
    if (WRITE) {
      const docUpdates = {
        waterTemp: reading.temp,
        waterTempAt: reading.stamp,
        waterTempProvider: reading.provider,
      };
      if (reading.promoteTempSource) {
        docUpdates.tempSource = reading.promoteTempSource;
      }
      batch.update(doc.ref, docUpdates);
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
