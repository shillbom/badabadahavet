#!/usr/bin/env node
/**
 * Refresh water temperatures for every seeded place whose stored reading
 * has gone stale (pass --all to force every place). The same run also
 * syncs, from the very same badplatsen detail doc the temperature comes
 * from, each Hav och Vatten place's:
 *   - official description (`bathInformation`) into
 *     `info`/`infoSource`/`infoUrl`, re-checked monthly per place;
 *     user-contributed info (infoSource === "user") is never touched.
 *   - water-quality checks (algae bloom, latest sample verdict, bathing
 *     advisories, EU classification) into `waterQuality`, re-checked every
 *     couple of days so summer blooms/advisories surface promptly.
 * Both are low-churn place-doc writes, gated on an actual change.
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
 * `source` field for docs seeded before `tempSource` existed.
 *
 * Readings are written to `placeTemps/{placeId}` and packed into the single
 * `tempSummary/current` doc — never onto the place docs, whose always-on
 * whole-collection listener would fan every write out to every connected
 * client. Clients read all map temps from the one summary doc
 * (~1 read/client/day). Each reading records `p` — which upstream actually
 * produced it, using that reading's own measurement date (never the time we
 * happened to fetch it). The `info`/`infoSource`/`infoUrl` description sync
 * still writes onto the place doc: it is low-churn (monthly per place).
 *
 * Usage (local):
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/update-temperatures.mjs           # dry-run
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/update-temperatures.mjs --write   # commit updates
 *
 *   node scripts/update-temperatures.mjs --write --all  # ignore freshness
 *
 * The GitHub Action at .github/workflows/temperatures.yml runs this
 * on a schedule.
 */

import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import {
  asReading,
  freshestReading,
  readingFromLegacyPlace,
  buildSummaryEntries,
  summaryChanged,
  extractWaterQuality,
  waterQualityChanged,
} from "../functions/tempLogic.js";

const WRITE = process.argv.includes("--write");
const ALL = process.argv.includes("--all");
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "badligan";

// Only refresh places whose stored reading is at least this old. The
// scheduled run is daily, so yesterday's readings always qualify, while
// places refreshed on demand earlier the same day (the refreshPlaceTemp
// callable) are skipped — every skip saves a Firestore write that would
// otherwise fan out to every client subscribed to `places`. Override
// with --all.
const REFRESH_IF_OLDER_THAN_MS = 12 * 60 * 60 * 1000;

// Per-bath detail document. The latest temperature reading is at the
// root level as `sampleTemperature` (string °C) + `sampleDate` (ms); the
// municipality's free-text description is `bathInformation`.
const TEMP_URL = (nutsCode) =>
  `https://badplatsen.havochvatten.se/badplatsen/api/detail/${encodeURIComponent(nutsCode)}`;

// The public per-bath page — stored as `infoUrl` so the app can link to
// the original next to the synced description.
const HAV_BATH_URL = (nutsCode) =>
  `https://badplatsen.havochvatten.se/badplatsen/karta/#/bath/${encodeURIComponent(nutsCode)}`;

// Descriptions change rarely; re-check each place's `bathInformation`
// monthly (`infoSyncedAt` bookkeeping) instead of on every daily run, so
// most days add zero extra writes. Override with --all.
const INFO_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;

// Water quality (algae blooms / bathing advisories) is time-sensitive in
// summer, so re-check it far more often than the description — every couple
// of days (`qualitySyncedAt` bookkeeping). The detail fetch is usually a
// cache hit (the temperature refresh already pulled it), so this rarely
// costs an extra upstream call; writes are still gated on an actual change.
const QUALITY_REFRESH_MS = 2 * 24 * 60 * 60 * 1000;

// Max stored length for the synced description. Matches
// PLACE_INFO_MAX_CHARS in functions/index.js — keep in sync.
const INFO_MAX_CHARS = 1200;

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

// One detail fetch per bath per run — the temperature resolution and the
// info sync both read the same document, so cache the parsed body.
const havDetailCache = new Map(); // nutsCode -> body | null (null = failed)

async function fetchHavDetail(nutsCode) {
  if (havDetailCache.has(nutsCode)) return havDetailCache.get(nutsCode);
  let body = null;
  try {
    const res = await fetch(TEMP_URL(nutsCode), {
      headers: { Accept: "application/json" },
    });
    if (res.ok) body = await res.json();
  } catch {
    // body stays null — treated as "couldn't check", never as "empty".
  }
  havDetailCache.set(nutsCode, body);
  return body;
}

/** Clean `bathInformation` into storable text, or null when there is none. */
function extractBathInfo(body) {
  const raw = body?.bathInformation;
  if (typeof raw !== "string") return null;
  const text = raw
    .replace(/<[^>]+>/g, " ") // municipalities occasionally paste HTML
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ") // collapse spaces/tabs, keep line breaks
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, INFO_MAX_CHARS);
  return text || null;
}

async function fetchTemp(nutsCode) {
  try {
    const data = await fetchHavDetail(nutsCode);
    if (!data) return null;
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

const toRad = (x) => (x * Math.PI) / 180;

function haversineMeters(a, b) {
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
  const withCoords = snap.docs.filter((d) => {
    const data = d.data();
    return typeof data.lat === "number" && typeof data.lng === "number";
  });
  // Current readings, freshest wins per place: on-demand refreshPlaceTemp
  // results in placeTemps, the summary written by the previous run, and —
  // on the first run after the split — the legacy waterTemp* fields still
  // sitting on old place docs (the automatic backfill; a no-op once those
  // are scrubbed). Feeds both the skip filter and the rebuilt summary, so
  // a skipped-fresh place keeps its entry.
  console.log("→ loading current readings…");
  const summaryRef = db.collection("tempSummary").doc("current");
  const [summarySnap, placeTempsSnap] = await Promise.all([
    summaryRef.get(),
    db.collection("placeTemps").get(),
  ]);
  const oldEntries = summarySnap.exists
    ? (summarySnap.data().entries ?? {})
    : {};
  const liveByPlace = new Map();
  placeTempsSnap.forEach((d) => liveByPlace.set(d.id, asReading(d.data())));
  const known = new Map();
  for (const d of withCoords) {
    known.set(
      d.id,
      freshestReading(
        liveByPlace.get(d.id),
        freshestReading(oldEntries[d.id], readingFromLegacyPlace(d.data())),
      ),
    );
  }

  // Temps: skip places that already have a recent reading (see
  // REFRESH_IF_OLDER_THAN_MS) — no upstream fetch, no Firestore write.
  const cutoff = Date.now() - REFRESH_IF_OLDER_THAN_MS;
  const tempDue = (doc) => {
    const at = known.get(doc.id)?.at;
    return ALL || typeof at !== "number" || at < cutoff;
  };
  // Info: only Hav och Vatten places have an official description to
  // sync, user-contributed info is never overwritten, and each place is
  // only re-checked monthly (see INFO_REFRESH_MS).
  const infoCutoff = Date.now() - INFO_REFRESH_MS;
  const infoDue = (data) =>
    data.source === "havochvatten.se" &&
    typeof data.externalId === "string" &&
    (!data.infoSource || data.infoSource === "havochvatten.se") &&
    (ALL ||
      typeof data.infoSyncedAt !== "number" ||
      data.infoSyncedAt < infoCutoff);
  // Water quality: only Hav och Vatten baths carry it, re-checked every
  // couple of days (see QUALITY_REFRESH_MS) so blooms/advisories surface
  // promptly even on a day the temperature reading was still fresh.
  const qualityCutoff = Date.now() - QUALITY_REFRESH_MS;
  const qualityDue = (data) =>
    data.source === "havochvatten.se" &&
    typeof data.externalId === "string" &&
    (ALL ||
      typeof data.qualitySyncedAt !== "number" ||
      data.qualitySyncedAt < qualityCutoff);
  const due = withCoords.filter(
    (d) => tempDue(d) || infoDue(d.data()) || qualityDue(d.data()),
  );
  console.log(
    `→ ${withCoords.length} places with coordinates, ${due.length} due for refresh` +
      (ALL ? " (--all)" : ` (${withCoords.length - due.length} still fresh)`),
  );

  let updated = 0;
  let infoUpdated = 0;
  let qualityUpdated = 0;
  let skipped = 0;
  let noTemp = 0;
  let processed = 0;
  let batch = db.batch();
  let inBatch = 0;

  const tty = process.stdout.isTTY;
  const writeProgress = () => {
    const line = `→ ${processed}/${due.length} (${updated} temps, ${infoUpdated} info, ${qualityUpdated} quality, ${skipped} unchanged, ${noTemp} no data)`;
    if (tty) {
      process.stdout.clearLine?.(0);
      process.stdout.cursorTo?.(0);
      process.stdout.write(line);
    } else if (processed % 25 === 0 || processed === due.length) {
      // Non-interactive (CI) — log every 25 to keep the action log useful.
      console.log(line);
    }
  };

  console.log("→ starting…");
  for (const doc of due) {
    const data = doc.data();
    // Place-doc writes: tempSource promotion (a rare once-ever flip) and
    // the info sync. Temperature readings go to placeTemps, never here.
    const docUpdates = {};

    let tempStatus = "not-due";
    if (tempDue(doc)) {
      const reading = await resolveReading(data);
      if (!reading) {
        // Nothing upstream — the place keeps its previous `known` entry (if
        // any) in the rebuilt summary.
        tempStatus = "no-data";
      } else {
        const next = {
          t: reading.temp,
          at: reading.stamp,
          p: reading.provider,
        };
        const cur = known.get(doc.id);
        const changed =
          !cur || cur.t !== next.t || cur.at !== next.at || cur.p !== next.p;
        const promote =
          reading.promoteTempSource &&
          data.tempSource !== reading.promoteTempSource;
        if (promote) {
          docUpdates.tempSource = reading.promoteTempSource;
        }
        if (changed) {
          known.set(doc.id, next);
          if (WRITE) {
            batch.set(
              db.collection("placeTemps").doc(doc.id),
              { placeId: doc.id, ...next, checkedAt: Date.now() },
              { merge: true },
            );
            inBatch++;
          }
        }
        tempStatus = changed || promote ? "updated" : "unchanged";
        if (tempStatus === "updated" && tty) {
          // Per-update detail line above the progress bar so the user sees
          // *something* happening, especially when most calls return no data.
          process.stdout.write(
            `\n   ✓ ${data.name} → ${reading.temp.toFixed(1)} °C (${reading.provider})\n`,
          );
        }
      }
    }

    if (infoDue(data)) {
      // Usually a cache hit — resolveReading already fetched this detail
      // doc for havochvatten-preferring places.
      const body = await fetchHavDetail(data.externalId);
      // A null body means the fetch failed: write nothing (not even the
      // bookkeeping stamp) so the next run retries.
      if (body) {
        docUpdates.infoSyncedAt = Date.now();
        const info = extractBathInfo(body);
        const infoUrl = HAV_BATH_URL(data.externalId);
        if (info && (info !== data.info || data.infoUrl !== infoUrl)) {
          docUpdates.info = info;
          docUpdates.infoSource = "havochvatten.se";
          docUpdates.infoUrl = infoUrl;
          docUpdates.infoUpdatedAt = Date.now();
          infoUpdated++;
        } else if (
          !info &&
          data.info &&
          data.infoSource === "havochvatten.se"
        ) {
          // The source dropped its text — drop the synced copy too.
          docUpdates.info = FieldValue.delete();
          docUpdates.infoSource = FieldValue.delete();
          docUpdates.infoUrl = FieldValue.delete();
          docUpdates.infoUpdatedAt = FieldValue.delete();
          infoUpdated++;
        }
      }
    }

    if (qualityDue(data)) {
      // Same detail doc as the temp/info sync — usually already cached.
      const body = await fetchHavDetail(data.externalId);
      // A null body means the fetch failed: write nothing (not even the
      // bookkeeping stamp) so the next run retries.
      if (body) {
        docUpdates.qualitySyncedAt = Date.now();
        const next = extractWaterQuality(body, Date.now());
        if (waterQualityChanged(data.waterQuality ?? null, next)) {
          docUpdates.waterQuality = next ?? FieldValue.delete();
          qualityUpdated++;
        }
      }
    }

    processed++;
    if (tempStatus === "updated") updated++;
    else if (tempStatus === "no-data") noTemp++;
    else if (tempStatus === "unchanged") skipped++;

    if (WRITE && Object.keys(docUpdates).length > 0) {
      batch.update(doc.ref, docUpdates);
      inBatch++;
    }
    if (WRITE && inBatch >= 400) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
    }
    writeProgress();
    await sleep(REQUEST_DELAY_MS);
  }
  if (WRITE && inBatch > 0) await batch.commit();

  // Rebuild the one summary doc every client subscribes to: the freshest
  // known reading for every current place (skipped-fresh ones included),
  // implicitly dropping entries for deleted places. A plain set (no merge)
  // so removals stick; only written when something actually changed, so a
  // no-change day costs the clients nothing.
  const newEntries = buildSummaryEntries(known);
  const entryCount = Object.keys(newEntries).length;
  if (!summaryChanged(oldEntries, newEntries)) {
    console.log(`\n→ tempSummary/current unchanged (${entryCount} entries)`);
  } else if (WRITE) {
    await summaryRef.set({ updatedAt: Date.now(), entries: newEntries });
    console.log(`\n→ tempSummary/current rewritten (${entryCount} entries)`);
  } else {
    console.log(
      `\n→ dry-run: tempSummary/current would be rewritten (${entryCount} entries)`,
    );
  }

  console.log(
    `\n✓ done — ${updated} temps updated, ${infoUpdated} info synced, ${qualityUpdated} quality synced, ${skipped} unchanged, ${noTemp} without data (of ${due.length})`,
  );
  if (!WRITE && (updated > 0 || infoUpdated > 0 || qualityUpdated > 0)) {
    console.log(
      `run again with --write to commit ${updated + infoUpdated + qualityUpdated} updates.`,
    );
  }
}

main().catch((e) => {
  console.error("✗", e);
  process.exit(1);
});
