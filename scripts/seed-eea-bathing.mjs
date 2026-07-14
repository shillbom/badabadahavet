#!/usr/bin/env node
/**
 * Seed places from the European Environment Agency "Bathing Water
 * Directive" dataset. Default targets: Denmark + Finland (EEA also covers
 * the other EU members + Albania + Switzerland + UK, available via the
 * --countries flag).
 *
 * Idempotent: safe to rerun. Existing EEA docs (matched by externalId)
 * are updated in place with any new/changed props rather than skipped or
 * duplicated; brand-new spots are created; spots within --min-distance of
 * a non-EEA master (e.g. a Swedish place) are still left untouched.
 *
 * NOTE on Norway: Norway is NOT in the EEA bathing-water dataset (the
 * Bathing Water Directive is EU-only; Norway reports separately and isn't
 * in the WISE feature service). For Norway we'll need a different source
 * — probably OSM `leisure=bathing_place` via Overpass, in a follow-up
 * script. Don't pass `NO` to --countries here; it will just return 0.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/seed-eea-bathing.mjs                       # dry run, DK+FI
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/seed-eea-bathing.mjs --countries=DK,FI     # explicit
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/seed-eea-bathing.mjs --write               # commit
 *
 *   node scripts/seed-eea-bathing.mjs --fixture=tmp/sample.geojson
 *     # offline test: read a local GeoJSON file instead of the EEA API,
 *     # and skip Firestore dedup if credentials aren't set.
 *
 * Source:
 *   EEA WISE Bathing Water (discomap ArcGIS REST FeatureServer). The
 *   exact layer ID is best-effort — override with --layer=N if the
 *   service is reshuffled. Field names vary between EEA dataset
 *   generations, so normalise() accepts several aliases.
 */

import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const args = parseArgs(process.argv.slice(2));
const WRITE = args.has("--write");
const FIXTURE = args.get("--fixture");
// Layer 0 is the full per-site point dataset (fields: bathingWaterName,
// bathingWaterIdentifier, countryCode, lon/lat, Point geometry). Layers
// 1–5 are multi-scale duplicates of it; layer 6 is country-aggregate
// polygons (countryName only) — don't use those for per-spot seeding.
const LAYER_ID = Number(args.get("--layer") ?? 0);
const COUNTRIES = (args.get("--countries") ?? "DK,FI")
  .split(",")
  .map((c) => c.trim().toUpperCase())
  .filter(Boolean);
// Anything closer than this to an existing place is treated as the
// same spot and skipped — the existing place wins (it's the "master").
// Matches the client-side PLACE_RADIUS_METERS used for "same spot"
// matching when logging a swim.
const MIN_DISTANCE_M = Number(args.get("--min-distance") ?? 100);
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "badligan";

const EEA_BASE =
  "https://water.discomap.eea.europa.eu/arcgis/rest/services/BathingWater/BathingWater_Dyna_WM/MapServer";
const PAGE_SIZE = 2000;

function parseArgs(argv) {
  const map = new Map();
  const set = new Set();
  for (const a of argv) {
    set.add(a);
    const eq = a.indexOf("=");
    if (a.startsWith("--") && eq !== -1)
      map.set(a.slice(0, eq), a.slice(eq + 1));
  }
  return { has: (k) => set.has(k), get: (k) => map.get(k) };
}

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

async function fetchFromFixture(path) {
  console.log(`→ reading fixture ${path}`);
  const json = JSON.parse(readFileSync(path, "utf8"));
  const features = Array.isArray(json) ? json : (json.features ?? []);
  const out = [];
  for (const f of features) {
    const p = normalize(f);
    if (p) out.push(p);
  }
  return out;
}

async function fetchEEA(country) {
  const places = [];
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      where: `countryCode='${country}'`,
      outFields: "*",
      outSR: "4326",
      returnGeometry: "true",
      f: "geojson",
      resultRecordCount: String(PAGE_SIZE),
      resultOffset: String(offset),
    });
    const url = `${EEA_BASE}/${LAYER_ID}/query?${params}`;
    console.log(`→ ${country}: fetching offset=${offset}`);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      throw new Error(
        `EEA responded ${res.status} ${res.statusText} for ${country} @ offset ${offset}`,
      );
    }
    const data = await res.json();
    const features = data.features ?? [];
    if (features.length === 0) break;
    for (const f of features) {
      const p = normalize(f, country);
      if (p) places.push(p);
    }
    // ArcGIS GeoJSON responses don't always include exceededTransferLimit
    // at the top level — fall back to "page was full → assume more".
    const more =
      data.exceededTransferLimit === true || features.length === PAGE_SIZE;
    if (!more) break;
    offset += features.length;
  }
  return places;
}

function normalize(item, fallbackCountry) {
  const props = item.properties ?? item;
  // EEA / WISE field names drift between dataset generations, so try a
  // handful of plausible aliases for each thing we care about.
  const name =
    props.bwName ??
    props.nameTxtInt ??
    props.nameText ??
    props.bathingWaterName ??
    props.NAME ??
    props.name;
  const country = (
    props.countryCode ??
    props.country ??
    props.cntryCode ??
    props.cntry ??
    fallbackCountry ??
    ""
  )
    .toString()
    .toUpperCase();
  const externalId =
    props.bathingWaterIdentifier ??
    props.bwid ??
    props.bwId ??
    props.eunisIdentifier ??
    props.id ??
    item.id ??
    null;

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

  if (!name || typeof lat !== "number" || typeof lng !== "number") return null;
  return {
    name: name.toString().trim().slice(0, 80),
    lat,
    lng,
    country: country || null,
    externalId: externalId ? String(externalId) : null,
  };
}

function dedupKey(p) {
  return `${p.name.toLowerCase()}|${p.lat.toFixed(4)}|${p.lng.toFixed(4)}`;
}

const toRad = (d) => (d * Math.PI) / 180;

function haversineMeters(a, b) {
  const R = 6_371_000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 0.01° grid (~1.1 km lat, ~0.5 km lng at 60°N) — coarse enough that
// "same cell + 8 neighbours" always covers any 100 m proximity check.
function gridKey(lat, lng) {
  return `${Math.round(lat * 100)}|${Math.round(lng * 100)}`;
}

function makeSpatialIndex() {
  const idx = new Map();
  return {
    add(p) {
      const k = gridKey(p.lat, p.lng);
      const arr = idx.get(k);
      if (arr) arr.push(p);
      else idx.set(k, [p]);
    },
    nearestWithin(p, maxMeters) {
      const lc = Math.round(p.lat * 100);
      const gc = Math.round(p.lng * 100);
      let best = null;
      let bestD = Infinity;
      for (let dl = -1; dl <= 1; dl++) {
        for (let dg = -1; dg <= 1; dg++) {
          const arr = idx.get(`${lc + dl}|${gc + dg}`);
          if (!arr) continue;
          for (const other of arr) {
            const d = haversineMeters(p, other);
            if (d <= maxMeters && d < bestD) {
              best = other;
              bestD = d;
            }
          }
        }
      }
      return best ? { place: best, meters: bestD } : null;
    },
  };
}

// The props every EEA place should carry. Used both for new docs and
// to backfill/update existing ones on a rerun.
function desiredProps(p) {
  return {
    tempSource: "open-meteo",
    ...(p.country ? { country: p.country } : {}),
    ...(p.externalId ? { externalId: p.externalId } : {}),
  };
}
// Return only the fields that differ from the existing doc.
function changedProps(existing, want) {
  const diff = {};
  for (const [k, v] of Object.entries(want)) {
    if (existing[k] !== v) diff[k] = v;
  }
  return diff;
}

async function main() {
  console.log(`→ project:   ${PROJECT_ID}`);
  console.log(`→ mode:      ${WRITE ? "WRITE" : "dry-run (no writes)"}`);
  console.log(`→ countries: ${COUNTRIES.join(", ") || "(none)"}`);
  console.log(`→ min dist:  ${MIN_DISTANCE_M} m (existing places are master)`);
  if (FIXTURE) console.log(`→ source:    fixture (${FIXTURE})`);
  else console.log(`→ source:    EEA discomap layer ${LAYER_ID}`);

  let places = [];
  if (FIXTURE) {
    places = await fetchFromFixture(FIXTURE);
  } else {
    for (const country of COUNTRIES) {
      const batch = await fetchEEA(country);
      console.log(`→ ${country}: ${batch.length} features`);
      places.push(...batch);
    }
  }
  console.log(`→ parsed ${places.length} places`);
  if (places.length === 0) {
    console.error("✗ no places parsed — check endpoint, layer ID, or fixture");
    process.exit(1);
  }

  // Local dedup pass — drop exact name+coord duplicates inside the feed
  // (a single bathing water can show up more than once if the EEA layer
  // holds historical snapshots). Cheap pre-pass before the spatial check.
  const localSeen = new Set();
  places = places.filter((p) => {
    const k = dedupKey(p);
    if (localSeen.has(k)) return false;
    localSeen.add(k);
    return true;
  });
  console.log(`→ ${places.length} after local dedup`);

  const haveCreds = Boolean(
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.GOOGLE_CLOUD_PROJECT,
  );

  // Spatial index. Existing Firestore places go in first so they win all
  // proximity checks — that's the "local versions are master" policy.
  // Accepted incoming places are added as we go, so two incoming features
  // within MIN_DISTANCE_M of each other are also collapsed (first wins).
  const index = makeSpatialIndex();
  let existingCount = 0;
  let db = null;
  // Existing EEA docs keyed by externalId, so a rerun updates them in
  // place (backfilling new props) instead of skipping or duplicating.
  const eeaById = new Map();

  if (haveCreds) {
    initAdmin();
    db = getFirestore();
    console.log("→ loading existing places from Firestore…");
    const existingSnap = await db.collection("places").get();
    for (const doc of existingSnap.docs) {
      const data = doc.data();
      if (typeof data.lat === "number" && typeof data.lng === "number") {
        index.add({
          name: data.name ?? "",
          lat: data.lat,
          lng: data.lng,
          source: data.source ?? "(unknown)",
          existing: true,
        });
        existingCount++;
        if (data.source === "eea.europa.eu/wise-bwd" && data.externalId) {
          eeaById.set(String(data.externalId), { id: doc.id, data });
        }
      }
    }
    console.log(`→ ${existingCount} existing places loaded into spatial index`);
  } else {
    console.log(
      "→ no Firebase credentials — skipping Firestore dedup (preview only)",
    );
  }

  const fresh = [];
  const updates = []; // { id, name, props } for existing EEA docs
  let skippedNearMaster = 0;
  let skippedNearIncoming = 0;
  let unchanged = 0;
  const skipSamples = [];
  for (const p of places) {
    // Already-imported EEA spot (same externalId) → update in place.
    const known = p.externalId ? eeaById.get(String(p.externalId)) : null;
    if (known) {
      const diff = changedProps(known.data, desiredProps(p));
      if (Object.keys(diff).length)
        updates.push({ id: known.id, name: p.name, props: diff });
      else unchanged++;
      continue;
    }
    const hit = index.nearestWithin(p, MIN_DISTANCE_M);
    if (hit) {
      if (hit.place.existing) skippedNearMaster++;
      else skippedNearIncoming++;
      if (skipSamples.length < 5) {
        skipSamples.push({
          incoming: p.name,
          near: hit.place.name,
          meters: Math.round(hit.meters),
          masterSource: hit.place.source,
        });
      }
      continue;
    }
    fresh.push(p);
    index.add({ name: p.name, lat: p.lat, lng: p.lng, existing: false });
  }
  if (haveCreds) {
    console.log(
      `→ ${fresh.length} new, ${updates.length} existing updated, ${unchanged} unchanged (${skippedNearMaster} within ${MIN_DISTANCE_M} m of existing master, ${skippedNearIncoming} collapsed inside feed)`,
    );
  } else {
    console.log(
      `→ ${fresh.length} new (${skippedNearIncoming} collapsed inside feed within ${MIN_DISTANCE_M} m)`,
    );
  }
  if (skipSamples.length) {
    console.log("  skip samples:");
    for (const s of skipSamples) {
      console.log(
        `    "${s.incoming}" ≈ "${s.near}" (${s.meters} m, source: ${s.masterSource ?? "(incoming)"})`,
      );
    }
  }

  if (!WRITE) {
    console.log("\nsample (first 5):");
    for (const p of fresh.slice(0, 5)) console.log("   ", p);
    if (COUNTRIES.length > 1) {
      console.log("\nby country:");
      const counts = new Map();
      for (const p of fresh)
        counts.set(p.country, (counts.get(p.country) ?? 0) + 1);
      for (const [c, n] of [...counts.entries()].toSorted())
        console.log(`  ${c}: ${n}`);
    }
    if (updates.length) {
      console.log(`\nwould update ${updates.length} existing EEA docs, e.g.:`);
      for (const u of updates.slice(0, 5))
        console.log(`    "${u.name}" ←`, u.props);
    }
    console.log(
      `\nrun again with --write${haveCreds ? "" : " (and GOOGLE_APPLICATION_CREDENTIALS)"} to commit ${fresh.length} new + ${updates.length} updated docs.`,
    );
    return;
  }

  if (!db) {
    console.error(
      "✗ --write requires Firebase credentials (GOOGLE_APPLICATION_CREDENTIALS)",
    );
    process.exit(1);
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
        createdBy: "system:eea-bwd",
        firstSwumAt: now,
        seeded: true,
        source: "eea.europa.eu/wise-bwd",
        // EEA has no live temperature feed — read from Open-Meteo satellite.
        ...desiredProps(p),
      });
    }
    await batch.commit();
    written += chunk.length;
    process.stdout.write(`\r→ wrote ${written}/${fresh.length} new`);
  }
  if (written) console.log("");

  // Backfill props onto already-imported EEA docs (idempotent rerun).
  let updated = 0;
  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize);
    const batch = db.batch();
    for (const u of chunk) {
      batch.update(db.collection("places").doc(u.id), u.props);
    }
    await batch.commit();
    updated += chunk.length;
    process.stdout.write(`\r→ updated ${updated}/${updates.length} existing`);
  }
  if (updated) console.log("");
  console.log("✓ done");
}

main().catch((e) => {
  console.error("✗", e);
  process.exit(1);
});
