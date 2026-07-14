#!/usr/bin/env node
/**
 * Seed places from OpenStreetMap via the Overpass API — a free, key-less,
 * community-maintained source. Fills gaps the official feeds miss (notably
 * Norway, which isn't in the EEA Bathing Water dataset; see the note in
 * seed-eea-bathing.mjs) and any informal wild-swim spots absent from the
 * Swedish Badplatsen feed.
 *
 * By default it imports designated natural swim spots — OSM
 * `leisure=swimming_area` and `leisure=bathing_place` — across the Nordics
 * (NO, SE, DK, FI). Broaden with --leisure / --natural (e.g. add beaches) or
 * narrow with --countries / --bbox.
 *
 * Idempotent: safe to rerun. Existing OSM docs (matched by externalId =
 * "<type>/<id>") are updated in place; brand-new spots are created; spots
 * within --min-distance of a non-OSM master (a Badplatsen/EEA place) are left
 * untouched — the existing place wins.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/seed-osm-swimming.mjs                      # dry run
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/seed-osm-swimming.mjs --write              # commit
 *
 *   node scripts/seed-osm-swimming.mjs --fixture=tmp/overpass.json
 *     # offline test: read a local Overpass JSON file instead of the API,
 *     # and skip Firestore dedup if credentials aren't set.
 *
 * Flags:
 *   --countries=NO,SE     ISO 3166-1 alpha-2 list (default NO,SE,DK,FI).
 *   --bbox=s,w,n,e         Query this bounding box instead of countries.
 *   --leisure=a,b          leisure=* values to match (default
 *                          swimming_area,bathing_place). Empty to disable.
 *   --natural=beach        natural=* values to also match (default none; pass
 *                          "beach" to include beaches).
 *   --include-unnamed      Import spots with no name tag (named a generic
 *                          "Badplats"). Default: skip them (low value here).
 *   --endpoint=URL         Overpass endpoint (default: public mirrors, tried
 *                          in turn on rate-limit/timeout).
 *   --min-distance=M       "Same spot as an existing place" radius (default 100).
 *   --timeout=S            Overpass server-side timeout (default 180).
 *
 * Data © OpenStreetMap contributors, ODbL. Seeded docs carry
 * source "openstreetmap.org" and link back to the element via infoUrl.
 */

import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const args = parseArgs(process.argv.slice(2));
const WRITE = args.has("--write");
const FIXTURE = args.get("--fixture");
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "badligan";

const COUNTRIES = (args.get("--countries") ?? "NO,SE,DK,FI")
  .split(",")
  .map((c) => c.trim().toUpperCase())
  .filter(Boolean);
const BBOX = args.get("--bbox"); // "south,west,north,east"
const LEISURE = (args.get("--leisure") ?? "swimming_area,bathing_place")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const NATURAL = (args.get("--natural") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const INCLUDE_UNNAMED = args.has("--include-unnamed");
const MIN_DISTANCE_M = Number(args.get("--min-distance") ?? 100);
const TIMEOUT_S = Number(args.get("--timeout") ?? 180);

// Public Overpass instances, tried in order — the main one rate-limits (429)
// and times out (504) under load, so we fall through to mirrors.
const ENDPOINTS = args.get("--endpoint")
  ? [args.get("--endpoint")]
  : [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
      "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    ];

// Overpass etiquette: identify the client.
const USER_AGENT =
  "badligan-seed/1.0 (+https://github.com/shillbom/badabadahavet)";

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A union of tag filters, e.g. ["leisure"~"^(swimming_area|bathing_place)$"]. */
function tagClauses(selector) {
  const out = [];
  if (LEISURE.length)
    out.push(`nwr["leisure"~"^(${LEISURE.join("|")})$"]${selector};`);
  if (NATURAL.length)
    out.push(`nwr["natural"~"^(${NATURAL.join("|")})$"]${selector};`);
  return out;
}

/** Build the Overpass QL query for one scope (a country code or the bbox). */
function buildQuery(scope) {
  const head = `[out:json][timeout:${TIMEOUT_S}];`;
  let selector, pre;
  if (scope.bbox) {
    pre = "";
    selector = `(${scope.bbox})`;
  } else {
    // Resolve the country polygon into an Overpass area, then filter inside it.
    pre = `area["ISO3166-1"="${scope.cc}"][admin_level=2]->.a;`;
    selector = "(area.a)";
  }
  const clauses = tagClauses(selector);
  if (clauses.length === 0) {
    throw new Error(
      "nothing to query — both --leisure and --natural are empty",
    );
  }
  return `${head}${pre}(${clauses.join("")});out center tags;`;
}

const MAX_ROUNDS = 3;

async function overpass(query) {
  let lastErr = null;
  // Round-robin across the mirrors: the public instances are frequently busy
  // (429 rate-limit / 504 gateway timeout), so on a transient failure we move
  // straight to the next mirror rather than hammering the busy one, and only
  // back off between full rounds.
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    for (const endpoint of ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT,
            Accept: "application/json",
          },
          body: `data=${encodeURIComponent(query)}`,
        });
        // 429 / 504 are transient — try the next mirror immediately.
        if (res.status === 429 || res.status === 504) {
          console.warn(
            `  ⚠ ${endpoint} → ${res.status} (round ${round}), next…`,
          );
          lastErr = new Error(`${endpoint} → ${res.status}`);
          continue;
        }
        if (!res.ok) {
          throw new Error(
            `${endpoint} responded ${res.status} ${res.statusText}`,
          );
        }
        return await res.json();
      } catch (e) {
        lastErr = e;
        console.warn(`  ⚠ ${endpoint} failed (round ${round}): ${e.message}`);
      }
    }
    if (round < MAX_ROUNDS) await sleep(round * 3000);
  }
  throw new Error(
    `all Overpass endpoints failed after ${MAX_ROUNDS} rounds (last: ${lastErr?.message ?? "unknown"}). ` +
      `The public servers may be overloaded — retry later, narrow with --bbox, or pass --endpoint=<your instance>.`,
  );
}

function elementsOf(data) {
  if (Array.isArray(data)) return data;
  return data.elements ?? [];
}

function normalize(el) {
  const tags = el.tags ?? {};
  const name =
    tags.name ??
    tags["name:sv"] ??
    tags["name:en"] ??
    tags.alt_name ??
    tags.loc_name ??
    null;

  // Nodes carry lat/lon; ways/relations get a computed `center` from
  // `out center`.
  let lat, lng;
  if (typeof el.lat === "number" && typeof el.lon === "number") {
    lat = el.lat;
    lng = el.lon;
  } else if (el.center) {
    lat = el.center.lat;
    lng = el.center.lon;
  }
  if (typeof lat !== "number" || typeof lng !== "number") return null;

  if (!name && !INCLUDE_UNNAMED) return null;

  const type = el.type ?? "node";
  const externalId = el.id != null ? `${type}/${el.id}` : null;
  const infoUrl = externalId
    ? `https://www.openstreetmap.org/${externalId}`
    : null;
  const info = cleanText(tags.description ?? tags.note ?? null);

  return {
    name: (name ?? "Badplats").toString().trim().slice(0, 80),
    named: Boolean(name),
    lat,
    lng,
    externalId,
    infoUrl,
    info,
  };
}

/** OSM free-text tags are plain (not HTML) but can be long / whitespace-y. */
function cleanText(s) {
  if (typeof s !== "string" || !s.trim()) return null;
  return s.replace(/\s+/g, " ").trim().slice(0, 1200) || null;
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

// 0.01° grid (~1.1 km lat, ~0.5 km lng at 60°N) — coarse enough that "same
// cell + 8 neighbours" always covers any 100 m proximity check.
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

// The props every OSM place should carry — new docs and rerun backfills.
function desiredProps(p) {
  return {
    // OSM has no temperature feed — read from Open-Meteo satellite.
    tempSource: "open-meteo",
    ...(p.externalId ? { externalId: p.externalId } : {}),
    // infoUrl only rides along with info — the Spot page renders the source
    // link next to the description, so a bare URL would be dead data.
    ...(p.info
      ? { info: p.info, infoSource: "openstreetmap.org", infoUrl: p.infoUrl }
      : {}),
  };
}

// Only the fields that differ; never clobber a user-authored description.
function changedProps(existing, want) {
  const diff = {};
  for (const [k, v] of Object.entries(want)) {
    if ((k === "info" || k === "infoUrl") && existing.infoSource === "user")
      continue;
    if (existing[k] !== v) diff[k] = v;
  }
  return diff;
}

async function collect() {
  if (FIXTURE) {
    console.log(`→ reading fixture ${FIXTURE}`);
    const json = JSON.parse(readFileSync(FIXTURE, "utf8"));
    return elementsOf(json).map(normalize).filter(Boolean);
  }

  const scopes = BBOX ? [{ bbox: BBOX }] : COUNTRIES.map((cc) => ({ cc }));
  const out = [];
  for (const scope of scopes) {
    const label = scope.bbox ? `bbox ${scope.bbox}` : scope.cc;
    const query = buildQuery(scope);
    console.log(`→ Overpass: ${label}`);
    const data = await overpass(query);
    const batch = elementsOf(data).map(normalize).filter(Boolean);
    console.log(`   ${batch.length} spots`);
    out.push(...batch);
    if (scopes.length > 1) await sleep(1500); // be gentle between queries
  }
  return out;
}

async function main() {
  console.log(`→ project:  ${PROJECT_ID}`);
  console.log(`→ mode:     ${WRITE ? "WRITE" : "dry-run (no writes)"}`);
  console.log(
    `→ tags:     ${[
      LEISURE.map((l) => `leisure=${l}`).join(", "),
      NATURAL.map((n) => `natural=${n}`).join(", "),
    ]
      .filter(Boolean)
      .join(", ")}`,
  );
  console.log(`→ scope:    ${BBOX ? `bbox ${BBOX}` : COUNTRIES.join(", ")}`);
  console.log(`→ unnamed:  ${INCLUDE_UNNAMED ? "included" : "skipped"}`);
  console.log(`→ min dist: ${MIN_DISTANCE_M} m (existing places are master)`);
  if (FIXTURE) console.log(`→ source:   fixture (${FIXTURE})`);
  else console.log(`→ source:   Overpass (${ENDPOINTS[0]})`);

  let places = await collect();
  console.log(`→ parsed ${places.length} spots total`);
  if (places.length === 0) {
    console.error(
      "✗ no spots parsed — check --countries/--bbox/--leisure or the fixture",
    );
    process.exit(1);
  }

  // Local dedup — drop exact name+coord duplicates (a spot can appear once per
  // country query if it straddles a border, etc.).
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

  // Spatial index — existing Firestore places go in first so they win all
  // proximity checks (the "local versions are master" policy). Accepted
  // incoming spots are added as we go, collapsing near-duplicates in the feed.
  const index = makeSpatialIndex();
  let existingCount = 0;
  let db = null;
  // Existing OSM docs keyed by externalId, so a rerun updates them in place.
  const osmById = new Map();

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
        if (data.source === "openstreetmap.org" && data.externalId) {
          osmById.set(String(data.externalId), { id: doc.id, data });
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
  const updates = [];
  let skippedNearMaster = 0;
  let skippedNearIncoming = 0;
  let unchanged = 0;
  const skipSamples = [];
  for (const p of places) {
    const known = p.externalId ? osmById.get(String(p.externalId)) : null;
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

  const namedFresh = fresh.filter((p) => p.named).length;
  if (haveCreds) {
    console.log(
      `→ ${fresh.length} new, ${updates.length} existing updated, ${unchanged} unchanged (${skippedNearMaster} within ${MIN_DISTANCE_M} m of existing master, ${skippedNearIncoming} collapsed inside feed)`,
    );
  } else {
    console.log(
      `→ ${fresh.length} new (${skippedNearIncoming} collapsed inside feed within ${MIN_DISTANCE_M} m)`,
    );
  }
  if (INCLUDE_UNNAMED)
    console.log(
      `   (${fresh.length - namedFresh} of the new spots are unnamed)`,
    );
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
    for (const p of fresh.slice(0, 5))
      console.log(
        `    "${p.name}" (${p.lat.toFixed(4)}, ${p.lng.toFixed(4)})${p.info ? " +info" : ""}  ${p.externalId ?? ""}`,
      );
    if (updates.length) {
      console.log(`\nwould update ${updates.length} existing OSM docs, e.g.:`);
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
        createdBy: "system:osm",
        firstSwumAt: now,
        seeded: true,
        source: "openstreetmap.org",
        ...desiredProps(p),
        ...(p.info ? { infoUpdatedAt: now } : {}),
      });
    }
    await batch.commit();
    written += chunk.length;
    process.stdout.write(`\r→ wrote ${written}/${fresh.length} new`);
  }
  if (written) console.log("");

  let updated = 0;
  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize);
    const batch = db.batch();
    for (const u of chunk)
      batch.update(db.collection("places").doc(u.id), u.props);
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
