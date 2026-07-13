#!/usr/bin/env node
/**
 * One-shot prefill of naturist (nude) bathing spots from the Swedish
 * Naturist Federation's map at https://www.naturism.se/naturistkarta/
 * (a WP Google Maps install — the markers are public via its REST API).
 * Not a recurring sync: run it locally once; the set barely changes.
 *
 *   - Markers within --radius of an existing place mark that place
 *     `nude: true` (plus the marker's description as `info` when the
 *     place has none). Places whose `nude` field is already set — true,
 *     or an explicit `false` tombstone from a user unflagging via
 *     setPlaceInfo — are left alone, so a rerun never undoes moderation.
 *   - Unmatched markers become new places (they're naturist baths that
 *     aren't in the official Badplatsen feed).
 *   - Indoor venues (Simhall / Badhus / Bastu — naturist swim nights,
 *     not bathing spots) are skipped unless --include-indoor is passed.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/seed-naturist-spots.mjs            # dry run (no writes)
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/seed-naturist-spots.mjs --write    # actually write
 *
 *   ... --radius=400            # match distance in meters (default 250)
 *   ... --include-indoor        # also import Simhall/Badhus/Bastu venues
 */

import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const INCLUDE_INDOOR = args.includes("--include-indoor");
const RADIUS_M = Number(
  (args.find((a) => a.startsWith("--radius=")) ?? "--radius=250").split("=")[1],
);
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "badligan";

const MARKERS_URL = "https://www.naturism.se/wp-json/wpgmza/v1/markers";
const KARTA_URL = "https://www.naturism.se/naturistkarta/";

// Same cap as the official-description sync and the setPlaceInfo
// function (PLACE_INFO_MAX_CHARS) — keep in sync.
const INFO_MAX_CHARS = 1200;

// Indoor naturist swim *sessions*, not bathing spots — skipped by default.
const INDOOR_RE = /simhall|badhus|bastu/i;

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

/** Marker descriptions are WordPress HTML — reduce to plain paragraphs. */
function cleanDescription(html) {
  if (typeof html !== "string" || !html.trim()) return null;
  const text = html
    .replace(/<\s*(p|br|div|li)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#8211;|&ndash;/gi, "–")
    .replace(/&#8217;|&rsquo;/gi, "’")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, INFO_MAX_CHARS);
  return text || null;
}

async function fetchMarkers() {
  console.log(`→ fetching ${MARKERS_URL}`);
  const res = await fetch(MARKERS_URL, {
    headers: { Accept: "application/json", "User-Agent": "badligan-seed" },
  });
  if (!res.ok) {
    throw new Error(`markers endpoint responded ${res.status}`);
  }
  const raw = await res.json();
  // The site hosts the same markers on more than one map (map_id 1 and 5
  // are duplicates) — dedupe on name + rounded position.
  const seen = new Set();
  const markers = [];
  for (const m of raw) {
    if (m.approved !== "1" && m.approved !== 1) continue;
    const lat = Number(m.lat);
    const lng = Number(m.lng);
    const title = (m.title ?? "").toString().trim();
    if (!title || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const key = `${title.toLowerCase()}|${lat.toFixed(4)}|${lng.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!INCLUDE_INDOOR && INDOOR_RE.test(title)) continue;
    const link = (m.link ?? "").toString().trim();
    markers.push({
      title: title.slice(0, 80),
      lat,
      lng,
      info: cleanDescription(m.description),
      infoUrl: /^https?:\/\//.test(link) ? link : KARTA_URL,
    });
  }
  return markers;
}

async function main() {
  initAdmin();
  const db = getFirestore();

  console.log(`→ project: ${PROJECT_ID}`);
  console.log(`→ mode:    ${WRITE ? "WRITE" : "dry-run (no writes)"}`);
  console.log(`→ radius:  ${RADIUS_M} m, indoor: ${INCLUDE_INDOOR}`);

  const markers = await fetchMarkers();
  console.log(`→ ${markers.length} naturist markers after dedup/filtering`);
  if (markers.length === 0) {
    console.error("✗ no markers parsed — has the site changed its map plugin?");
    process.exit(1);
  }

  console.log("→ loading existing places…");
  const snap = await db.collection("places").get();
  const places = snap.docs
    .map((d) => ({ ref: d.ref, data: d.data() }))
    .filter(
      (p) => typeof p.data.lat === "number" && typeof p.data.lng === "number",
    );
  console.log(`→ ${places.length} places loaded`);

  const updates = []; // { ref, fields, label }
  const creates = []; // marker
  let alreadyFlagged = 0;

  for (const m of markers) {
    let best = null;
    let bestDist = Infinity;
    for (const p of places) {
      const dist = haversineMeters(m, p.data);
      if (dist < bestDist) {
        best = p;
        bestDist = dist;
      }
    }
    if (best && bestDist <= RADIUS_M) {
      // `nude` already true or an explicit user unflag — hands off.
      if (best.data.nude !== undefined) {
        alreadyFlagged++;
        continue;
      }
      const fields = { nude: true, nudeSource: "naturism.se" };
      if (m.info && !best.data.info) {
        fields.info = m.info;
        fields.infoSource = "naturism.se";
        fields.infoUrl = m.infoUrl;
        fields.infoUpdatedAt = Date.now();
      }
      updates.push({
        ref: best.ref,
        fields,
        label: `${m.title} → ${best.data.name} (${Math.round(bestDist)} m${fields.info ? ", +info" : ""})`,
      });
    } else {
      creates.push(m);
    }
  }

  console.log(`\n→ ${updates.length} existing places to flag as naturist:`);
  for (const u of updates) console.log(`   ✓ ${u.label}`);
  console.log(`→ ${alreadyFlagged} matches already had a nude flag (skipped)`);
  console.log(`→ ${creates.length} new places to create:`);
  for (const c of creates)
    console.log(
      `   + ${c.title} (${c.lat.toFixed(4)}, ${c.lng.toFixed(4)})${c.info ? " +info" : ""}`,
    );

  if (!WRITE) {
    console.log(
      `\nrun again with --write to commit ${updates.length + creates.length} changes.`,
    );
    return;
  }

  const batch = db.batch();
  for (const u of updates) batch.update(u.ref, u.fields);
  const now = Date.now();
  for (const c of creates) {
    const ref = db.collection("places").doc();
    batch.set(ref, {
      id: ref.id,
      name: c.title,
      lat: c.lat,
      lng: c.lng,
      createdBy: "system:naturism",
      firstSwumAt: now,
      seeded: true,
      source: "naturism.se",
      // Not in any official temperature feed — satellite data only.
      tempSource: "open-meteo",
      nude: true,
      nudeSource: "naturism.se",
      ...(c.info
        ? {
            info: c.info,
            infoSource: "naturism.se",
            infoUrl: c.infoUrl,
            infoUpdatedAt: now,
          }
        : {}),
    });
  }
  await batch.commit();
  console.log(
    `\n✓ done — ${updates.length} flagged, ${creates.length} created`,
  );
}

main().catch((e) => {
  console.error("✗", e);
  process.exit(1);
});
