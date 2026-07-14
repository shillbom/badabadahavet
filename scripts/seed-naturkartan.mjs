#!/usr/bin/env node
/**
 * Seed places from Naturkartan (https://www.naturkartan.se), the OutdoorMap
 * nature guide. Naturkartan tags every point of interest with one or more
 * categories; this script pulls the ones in the "swim/bathing" category and
 * imports them as places (facilities, description and a link back to the
 * spot's Naturkartan page ride along as `info`).
 *
 * Idempotent: safe to rerun. Existing Naturkartan docs (matched by
 * externalId) are updated in place with any new/changed props rather than
 * skipped or duplicated; brand-new spots are created; spots within
 * --min-distance of a non-Naturkartan master (e.g. a Swedish Badplatsen
 * place) are left untouched — the existing place wins.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/seed-naturkartan.mjs                       # dry run
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/seed-naturkartan.mjs --write               # commit
 *
 *   node scripts/seed-naturkartan.mjs --fixture=tmp/sample.json
 *     # offline test: read a local JSON file instead of hitting the API,
 *     # and skip Firestore dedup if credentials aren't set.
 *
 * Flags:
 *   --sites-url=URL      Override the sites endpoint (see NOTE below).
 *   --accept=MEDIATYPE   Force the Accept header (default: auto-probe, see NOTE).
 *   --locale=sv|en       Language for names/descriptions (default sv).
 *   --per-page=N         Page size (default 500).
 *   --max-pages=N        Safety cap on pages fetched (default 200).
 *   --category=REGEX     Category name/slug match (default: bad/swim/bath…).
 *   --category-ids=1,2   Only these category ids (also sent to the API as a
 *                        server-side filter, so the whole catalogue isn't
 *                        pulled). Recommended for the live run once you know
 *                        the swim category id — see the dry-run histogram.
 *   --no-category-filter Import every site returned (skip the swim filter).
 *   --min-distance=M     "Same spot as an existing place" radius (default 100).
 *
 * NOTE on the endpoint: Naturkartan's public API is documented (OpenAPI 3.0)
 * at https://apiv3.naturkartan.se/docs. The exact host/path has moved between
 * generations (`api.naturkartan.se/v3/...` → `apiv3.naturkartan.se/...`), so
 * the default below is best-effort and overridable with --sites-url. The
 * response reader accepts JSON:API (`data[].attributes`), a flat `sites`/
 * `data` array, or GeoJSON `features`, and normalize() tries several field
 * aliases — so a shape drift shouldn't need a code change, just a flag. Run a
 * dry run first: it prints the category histogram and sample docs so you can
 * confirm the swim category before writing.
 *
 * The server 406s if the Accept header/format doesn't suit the route, so
 * fetchSites() probes a few strategies (JSON:API vendor media type, a `.json`
 * path, plain JSON) and reuses the first the server accepts — override with
 * --accept and/or a `.json` --sites-url if the probe can't find one.
 */

import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const args = parseArgs(process.argv.slice(2));
const WRITE = args.has("--write");
const FIXTURE = args.get("--fixture");
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "badligan";

const SITES_URL =
  args.get("--sites-url") ?? "https://api.naturkartan.se/v3/sites";
// Explicit Accept header. Left unset, fetchSites() probes a few strategies
// (the API 406s on the wrong one) and reuses whichever the server accepts.
const ACCEPT = args.get("--accept");
const LOCALE = args.get("--locale") ?? "sv";
const PER_PAGE = Number(args.get("--per-page") ?? 500);
const MAX_PAGES = Number(args.get("--max-pages") ?? 200);
// Which Naturkartan categories count as swim spots. Matched (case-insensitive)
// against each category's name and slug. Swedish "Badplats"/"Bad" + English.
const CATEGORY_RE = new RegExp(
  args.get("--category") ??
    "badplats|bathing|swimming|swim|bath|(^|\\b)bad(\\b|$)",
  "i",
);
const CATEGORY_IDS = (args.get("--category-ids") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const NO_CATEGORY_FILTER = args.has("--no-category-filter");
// Anything closer than this to an existing place is treated as the same spot
// and skipped — the existing place wins (it's the "master"). Matches the
// client-side PLACE_RADIUS_METERS used for "same spot" matching, and the EEA
// seeder's default.
const MIN_DISTANCE_M = Number(args.get("--min-distance") ?? 100);

// Same cap as the naturist seeder / setPlaceInfo (PLACE_INFO_MAX_CHARS).
const INFO_MAX_CHARS = 1200;

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

/** Pull the site array out of whatever envelope the API/fixture returns. */
function itemsOf(data) {
  if (Array.isArray(data)) return data;
  return data.sites ?? data.data ?? data.features ?? data.results ?? [];
}

/** JSON:API responses carry related records (categories) in a top-level
 *  `included` array — index them by "type:id" so a site's relationship
 *  pointers can be resolved to names/slugs. */
function indexIncluded(data) {
  const idx = new Map();
  const inc = data && !Array.isArray(data) ? data.included : null;
  if (Array.isArray(inc)) {
    for (const r of inc) {
      if (r && r.type != null && r.id != null) idx.set(`${r.type}:${r.id}`, r);
    }
  }
  return idx;
}

/** Return [{ id, label }] of a site's categories, trying the handful of
 *  shapes Naturkartan / JSON:API might use. `label` is name+slug lowercased
 *  for the regex match; `id` is used for --category-ids filtering. */
function categoriesOf(item, included) {
  const attrs = item.attributes ?? item.properties ?? item;
  const out = [];
  const push = (id, ...labels) => {
    const label = labels.filter(Boolean).join(" ").toLowerCase();
    out.push({ id: id != null ? String(id) : null, label });
  };

  // JSON:API relationship pointers resolved via `included`.
  const rel =
    item.relationships?.categories?.data ?? item.relationships?.category?.data;
  const rels = Array.isArray(rel) ? rel : rel ? [rel] : [];
  for (const r of rels) {
    const full = included.get(`${r.type}:${r.id}`);
    const a = full?.attributes ?? full ?? {};
    push(r.id, a.name, a.title, a.slug, a.key);
  }

  // Inline category arrays/objects on the attributes.
  const inline = attrs.categories ?? attrs.category ?? attrs.category_names;
  const arr = Array.isArray(inline) ? inline : inline ? [inline] : [];
  for (const c of arr) {
    if (c == null) continue;
    if (typeof c === "string" || typeof c === "number") push(c, String(c));
    else push(c.id ?? c.category_id, c.name, c.title, c.slug, c.key);
  }

  // Bare id arrays.
  for (const id of attrs.category_ids ?? []) push(id, String(id));

  return out;
}

/** Naturkartan descriptions can be HTML — reduce to plain paragraphs, same
 *  cleaning the naturist seeder does for WordPress markup. */
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

function normalize(item, included) {
  // JSON:API nests everything under `attributes`; flat/GeoJSON put it on the
  // object (GeoJSON under `properties`). Accept all three.
  const attrs = item.attributes ?? item.properties ?? item;

  const name = attrs.name ?? attrs.title ?? attrs.heading;

  let lat, lng;
  if (item.geometry?.type === "Point") {
    [lng, lat] = item.geometry.coordinates ?? [];
  } else {
    lat = num(attrs.lat ?? attrs.latitude);
    // Naturkartan uses `long` for longitude; also accept lng/longitude.
    lng = num(attrs.long ?? attrs.lng ?? attrs.lon ?? attrs.longitude);
  }

  const externalId = item.id ?? attrs.id ?? attrs.slug ?? null;
  const slug = attrs.slug ?? null;

  const info = cleanDescription(
    attrs.excerpt ??
      attrs.preamble ??
      attrs.description ??
      attrs.body ??
      attrs.summary,
  );

  // Prefer an explicit permalink from the payload; fall back to a slug-based
  // URL, then the site root. (Full site URLs include a region slug we don't
  // reliably have, so a payload-provided URL is best.)
  const url =
    firstUrl(
      attrs.url,
      attrs.permalink,
      attrs.web_url,
      attrs.canonical_url,
      item.links?.self,
    ) ??
    (slug
      ? `https://www.naturkartan.se/${LOCALE}/${slug}`
      : `https://www.naturkartan.se/${LOCALE}`);

  if (!name || typeof lat !== "number" || typeof lng !== "number") return null;
  return {
    name: name.toString().trim().slice(0, 80),
    lat,
    lng,
    externalId: externalId != null ? String(externalId) : null,
    info,
    infoUrl: url,
    categories: categoriesOf(item, included),
  };
}

function num(v) {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : undefined;
}

function firstUrl(...vals) {
  for (const v of vals) {
    if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
  }
  return null;
}

function matchesSwim(p) {
  if (NO_CATEGORY_FILTER) return true;
  if (CATEGORY_IDS.length) {
    return p.categories.some((c) => c.id && CATEGORY_IDS.includes(c.id));
  }
  return p.categories.some((c) => CATEGORY_RE.test(c.label));
}

async function fetchFromFixture(path) {
  console.log(`→ reading fixture ${path}`);
  const json = JSON.parse(readFileSync(path, "utf8"));
  const included = indexIncluded(json);
  const out = [];
  for (const item of itemsOf(json)) {
    const p = normalize(item, included);
    if (p) out.push(p);
  }
  return out;
}

// Content-negotiation strategies, tried in order until the server stops
// answering 406/415. The API is JSON:API-flavoured, so the vendor media type
// and a `.json` route are the likely winners; plain application/json (what a
// naive client sends, and what 406s) is kept last as a fallback. The first
// success is cached in `negChoice` and reused for every later page.
const NEG_STRATEGIES = [
  { suffix: "", accept: "application/vnd.api+json" },
  { suffix: ".json", accept: "application/json" },
  { suffix: ".json", accept: "application/vnd.api+json" },
  { suffix: "", accept: "application/json" },
  { suffix: "", accept: "*/*" },
];
let negChoice = null;

function urlFor(suffix, params) {
  let base = SITES_URL;
  if (suffix === ".json" && !base.endsWith(".json")) base += ".json";
  return `${base}?${params}`;
}

function strategies() {
  if (ACCEPT) {
    const suffix = SITES_URL.endsWith(".json") ? ".json" : "";
    return [{ suffix, accept: ACCEPT }];
  }
  return negChoice ? [negChoice] : NEG_STRATEGIES;
}

async function requestPage(params) {
  let last = null;
  for (const s of strategies()) {
    const url = urlFor(s.suffix, params);
    const res = await fetch(url, {
      headers: { Accept: s.accept, "User-Agent": "badligan-seed" },
    });
    if (res.ok) {
      if (!negChoice && !ACCEPT) {
        negChoice = s;
        console.log(`→ content negotiation: Accept "${s.accept}"${s.suffix}`);
      }
      return res;
    }
    // 406/415 = wrong Accept/format; probe the next strategy. Anything else
    // (404 bad path, 5xx…) is a real failure — surface it immediately.
    if (res.status !== 406 && res.status !== 415) {
      throw new Error(
        `Naturkartan responded ${res.status} ${res.statusText} for ${url}`,
      );
    }
    last = { status: res.status, text: res.statusText, url };
  }
  throw new Error(
    `Naturkartan responded ${last?.status ?? 406} ${last?.text ?? "Not Acceptable"} to every ` +
      `content-negotiation strategy (last: ${last?.url}). Pass --accept=<mediatype> and/or a ` +
      `--sites-url with the right path/extension — see https://apiv3.naturkartan.se/docs`,
  );
}

async function fetchSites() {
  const places = [];
  let page = 1;
  for (; page <= MAX_PAGES; page++) {
    const params = new URLSearchParams({
      locale: LOCALE,
      per_page: String(PER_PAGE),
      page: String(page),
    });
    // Server-side category filter when ids are known — avoids pulling the
    // whole catalogue. Sent under a couple of plausible key spellings; the
    // API ignores the ones it doesn't recognise.
    for (const id of CATEGORY_IDS) {
      params.append("category_ids[]", id);
      params.append("filter[categories]", id);
    }
    console.log(`→ fetching page ${page}`);
    const res = await requestPage(params);
    const data = await res.json();
    const included = indexIncluded(data);
    const items = itemsOf(data);
    if (items.length === 0) break;
    for (const item of items) {
      const p = normalize(item, included);
      if (p) places.push(p);
    }
    if (items.length < PER_PAGE) break;
  }
  if (page > MAX_PAGES) {
    console.warn(
      `⚠ hit --max-pages=${MAX_PAGES}; there may be more sites. Re-run with a higher cap or a category filter.`,
    );
  }
  return places;
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

// The props every Naturkartan place should carry — used for new docs and to
// backfill/update existing ones on a rerun.
function desiredProps(p) {
  return {
    // Naturkartan has no live temperature feed — read from Open-Meteo.
    tempSource: "open-meteo",
    ...(p.externalId ? { externalId: p.externalId } : {}),
    // infoUrl only rides along with info — the Spot page renders the source
    // link next to the description, so a bare URL would be dead data.
    ...(p.info
      ? { info: p.info, infoSource: "naturkartan.se", infoUrl: p.infoUrl }
      : {}),
  };
}

// Only the fields that differ from the existing doc. Never clobbers a
// user-authored description (infoSource === "user").
function changedProps(existing, want) {
  const diff = {};
  for (const [k, v] of Object.entries(want)) {
    if ((k === "info" || k === "infoUrl") && existing.infoSource === "user")
      continue;
    if (existing[k] !== v) diff[k] = v;
  }
  return diff;
}

async function main() {
  console.log(`→ project:  ${PROJECT_ID}`);
  console.log(`→ mode:     ${WRITE ? "WRITE" : "dry-run (no writes)"}`);
  console.log(`→ locale:   ${LOCALE}`);
  console.log(`→ min dist: ${MIN_DISTANCE_M} m (existing places are master)`);
  console.log(
    `→ filter:   ${
      NO_CATEGORY_FILTER
        ? "none (all sites)"
        : CATEGORY_IDS.length
          ? `category ids ${CATEGORY_IDS.join(", ")}`
          : `category ~ /${CATEGORY_RE.source}/i`
    }`,
  );
  if (FIXTURE) console.log(`→ source:   fixture (${FIXTURE})`);
  else console.log(`→ source:   ${SITES_URL}`);

  let all = FIXTURE ? await fetchFromFixture(FIXTURE) : await fetchSites();
  console.log(`→ parsed ${all.length} sites`);
  if (all.length === 0) {
    console.error(
      "✗ no sites parsed — check --sites-url / --fixture and the response shape",
    );
    process.exit(1);
  }

  // Diagnostic: what categories came back (top 25). Helps pick --category-ids
  // for the live run when the swim category id isn't known yet.
  if (!CATEGORY_IDS.length) {
    const hist = new Map();
    for (const p of all)
      for (const c of p.categories) {
        const key = `${c.label || "(none)"}${c.id ? ` [${c.id}]` : ""}`;
        hist.set(key, (hist.get(key) ?? 0) + 1);
      }
    const top = [...hist.entries()]
      .toSorted((a, b) => b[1] - a[1])
      .slice(0, 25);
    if (top.length) {
      console.log("→ categories seen (name [id] × count):");
      for (const [label, n] of top) console.log(`     ${n}× ${label}`);
    }
  }

  let places = all.filter(matchesSwim);
  console.log(`→ ${places.length} match the swim filter`);

  // Local dedup pass — drop exact name+coord duplicates inside the feed.
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
  // proximity checks — the "local versions are master" policy. Accepted
  // incoming places are added as we go, so two incoming sites within
  // MIN_DISTANCE_M of each other are also collapsed (first wins).
  const index = makeSpatialIndex();
  let existingCount = 0;
  let db = null;
  // Existing Naturkartan docs keyed by externalId, so a rerun updates them in
  // place (backfilling new props) instead of skipping or duplicating.
  const nkById = new Map();

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
        if (data.source === "naturkartan.se" && data.externalId) {
          nkById.set(String(data.externalId), { id: doc.id, data });
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
  const updates = []; // { id, name, props } for existing Naturkartan docs
  let skippedNearMaster = 0;
  let skippedNearIncoming = 0;
  let unchanged = 0;
  const skipSamples = [];
  for (const p of places) {
    // Already-imported Naturkartan spot (same externalId) → update in place.
    const known = p.externalId ? nkById.get(String(p.externalId)) : null;
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
    for (const p of fresh.slice(0, 5))
      console.log(
        `    "${p.name}" (${p.lat.toFixed(4)}, ${p.lng.toFixed(4)})${p.info ? " +info" : ""}`,
      );
    if (updates.length) {
      console.log(
        `\nwould update ${updates.length} existing Naturkartan docs, e.g.:`,
      );
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
        createdBy: "system:naturkartan",
        firstSwumAt: now,
        seeded: true,
        source: "naturkartan.se",
        ...desiredProps(p),
        ...(p.info ? { infoUpdatedAt: now } : {}),
      });
    }
    await batch.commit();
    written += chunk.length;
    process.stdout.write(`\r→ wrote ${written}/${fresh.length} new`);
  }
  if (written) console.log("");

  // Backfill props onto already-imported Naturkartan docs (idempotent rerun).
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
