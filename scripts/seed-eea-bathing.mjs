#!/usr/bin/env node
/**
 * Seed places from the European Environment Agency "Bathing Water
 * Directive" dataset. Default targets: Denmark + Finland (EEA also covers
 * the other EU members + Albania + Switzerland + UK, available via the
 * --countries flag).
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
const LAYER_ID = Number(args.get("--layer") ?? 6);
const COUNTRIES = (args.get("--countries") ?? "DK,FI")
  .split(",")
  .map((c) => c.trim().toUpperCase())
  .filter(Boolean);
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

async function main() {
  console.log(`→ project:   ${PROJECT_ID}`);
  console.log(`→ mode:      ${WRITE ? "WRITE" : "dry-run (no writes)"}`);
  console.log(`→ countries: ${COUNTRIES.join(", ") || "(none)"}`);
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

  // Local dedup pass (a single bathing water can show up more than once
  // if the EEA layer holds historical snapshots).
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

  let fresh = places;
  let db = null;
  if (haveCreds) {
    initAdmin();
    db = getFirestore();
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
    fresh = places.filter((p) => !existingKeys.has(dedupKey(p)));
    console.log(
      `→ ${fresh.length} new (${places.length - fresh.length} already in Firestore)`,
    );
  } else {
    console.log(
      "→ no Firebase credentials — skipping Firestore dedup (preview only)",
    );
  }

  if (!WRITE) {
    console.log("\nsample (first 5):");
    for (const p of fresh.slice(0, 5)) console.log("   ", p);
    if (COUNTRIES.length > 1) {
      console.log("\nby country:");
      const counts = new Map();
      for (const p of fresh)
        counts.set(p.country, (counts.get(p.country) ?? 0) + 1);
      for (const [c, n] of [...counts.entries()].sort())
        console.log(`  ${c}: ${n}`);
    }
    console.log(
      `\nrun again with --write${haveCreds ? "" : " (and GOOGLE_APPLICATION_CREDENTIALS)"} to commit ${fresh.length} docs.`,
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
        ...(p.country ? { country: p.country } : {}),
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
