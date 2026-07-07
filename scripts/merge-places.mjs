#!/usr/bin/env node
/**
 * Merge duplicate places: move every session from a duplicate place onto the
 * spot it duplicates, fix everything the move invalidates, then delete the
 * duplicate. Handles:
 *
 *   - sessions.{placeId,placeName,lat,lng} — retargeted to the kept place
 *   - sessions.{isUniqueForUser,points}    — after a merge a user may have
 *     several swims at the kept place; only the earliest keeps the +3 new-spot
 *     bonus, the rest are recomputed with swimPoints()
 *   - users.scores                         — per-year totals recomputed for
 *     every user whose session points changed
 *   - users.toswim                         — bookmarks keyed by the duplicate
 *     are re-keyed to the kept place (earliest addedAt wins if both exist)
 *   - places.{lastSwimAt,lastSwimBy,lastSwimBorder,firstSwumAt} on the kept
 *     place — restamped from the merged session set
 *
 * Idempotent — derives everything from current data, so it's safe to re-run
 * after a partial failure.
 *
 * Find the place to merge into (lists nearby candidates, no writes):
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/merge-places.mjs --from <duplicatePlaceId>
 *
 * Merge (dry-run first, then --write; --from/--to may repeat for batches):
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     node scripts/merge-places.mjs \
 *       --from <duplicatePlaceId> --to <keptPlaceId> [--write]
 */
import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { swimPoints, swimYear } from "../functions/scoring.js";

const WRITE = process.argv.includes("--write");
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "badligan";

// Pair each --from with the --to that follows it (if any).
function parsePairs(argv) {
  const pairs = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--from") {
      pairs.push({ from: argv[++i], to: null });
    } else if (argv[i] === "--to") {
      const last = pairs[pairs.length - 1];
      if (!last || last.to) {
        console.error("--to must follow a --from");
        process.exit(1);
      }
      last.to = argv[++i];
    }
  }
  return pairs;
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

function haversineMeters(a, b) {
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

const pairs = parsePairs(process.argv.slice(2));
if (!pairs.length || pairs.some((p) => !p.from)) {
  console.error(
    "Usage: node scripts/merge-places.mjs --from <dupId> [--to <keptId>] [--write]",
  );
  process.exit(1);
}

const app = initAdmin();
const db = getFirestore(app);

const [placesSnap, sessionsSnap, usersSnap] = await Promise.all([
  db.collection("places").get(),
  db.collection("sessions").get(),
  db.collection("users").get(),
]);
const places = new Map(placesSnap.docs.map((d) => [d.id, d.data()]));
const sessions = sessionsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

const sessionCount = (placeId) =>
  sessions.filter((s) => s.placeId === placeId).length;

// ── candidate mode: any --from without a --to lists nearby places ──
const unresolved = pairs.filter((p) => !p.to);
if (unresolved.length) {
  for (const { from } of unresolved) {
    const dup = places.get(from);
    if (!dup) {
      console.error(`place ${from} not found`);
      continue;
    }
    console.log(
      `\n"${dup.name}" (${from}) at ${dup.lat}, ${dup.lng} — ` +
        `${sessionCount(from)} session(s). Nearby places:`,
    );
    const candidates = [...places.entries()]
      .filter(([id]) => id !== from)
      .map(([id, p]) => ({ id, p, dist: haversineMeters(dup, p) }))
      .filter((c) => c.dist <= 500)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 8);
    if (!candidates.length) {
      console.log("  (none within 500 m)");
      continue;
    }
    for (const c of candidates) {
      console.log(
        `  ${Math.round(c.dist).toString().padStart(4)} m  ${c.id}  ` +
          `"${c.p.name}"  ${sessionCount(c.id)} session(s)` +
          (c.p.seeded ? "  [seeded]" : ""),
      );
    }
  }
  console.log("\nRe-run with --to <keptId> for each --from to merge.");
  process.exit(0);
}

// ── validate ──
const fromIds = new Set(pairs.map((p) => p.from));
for (const { from, to } of pairs) {
  if (from === to) {
    console.error(`--from and --to are the same place (${from})`);
    process.exit(1);
  }
  if (fromIds.has(to)) {
    console.error(`${to} is both a merge target and a duplicate — split runs`);
    process.exit(1);
  }
  if (!places.has(to)) {
    console.error(`kept place ${to} not found`);
    process.exit(1);
  }
  if (!places.has(from)) {
    // Sessions can outlive their place; retargeting still works.
    console.warn(`note: duplicate place ${from} has no doc (already deleted?)`);
  }
}

// ── plan ──
const targetOf = new Map(pairs.map((p) => [p.from, p.to]));
const sessionUpdates = new Map(); // id -> partial update
const affectedUids = new Set();

// 1. Retarget sessions on a duplicate to the kept place. Session lat/lng is
//    the pin the swim was logged at, so it follows the kept place's pin.
for (const s of sessions) {
  const to = targetOf.get(s.placeId);
  if (!to) continue;
  const kept = places.get(to);
  sessionUpdates.set(s.id, {
    placeId: to,
    placeName: kept.name,
    lat: kept.lat,
    lng: kept.lng,
  });
  s.placeId = to; // so the uniqueness pass below sees the merged world
  affectedUids.add(s.uid);
}
const moved = sessionUpdates.size;

// 2. Re-decide the +3 new-spot bonus per (user, kept place): the earliest
//    swim keeps it, every other one loses it. logSession sets the flag on
//    "first session at this placeId", so after a merge duplicates may exist.
for (const { to } of pairs) {
  const byUser = new Map();
  for (const s of sessions) {
    if (s.placeId !== to) continue;
    let list = byUser.get(s.uid);
    if (!list) byUser.set(s.uid, (list = []));
    list.push(s);
  }
  for (const [uid, list] of byUser) {
    list.sort(
      (a, b) =>
        a.date - b.date ||
        (a.createdAt ?? 0) - (b.createdAt ?? 0) ||
        a.id.localeCompare(b.id),
    );
    list.forEach((s, i) => {
      const isUnique = i === 0;
      if (s.isUniqueForUser === isUnique) return;
      const points = swimPoints(isUnique, !!s.isWinter);
      const upd = sessionUpdates.get(s.id) ?? {};
      sessionUpdates.set(s.id, { ...upd, isUniqueForUser: isUnique, points });
      s.isUniqueForUser = isUnique;
      s.points = points;
      affectedUids.add(uid);
      console.log(
        `  points: ${s.displayName ?? uid} ${new Date(s.date).toISOString().slice(0, 10)} ` +
          `at "${places.get(to).name}" -> ${points} (unique: ${isUnique})`,
      );
    });
  }
}

// 3. Recompute affected users' per-year scores and leaderboard stats from
//    their (updated) sessions — merging places changes isUniqueForUser, so
//    both `scores` and `statsByYear.uniquePlaces` can shift.
const scoreUpdates = new Map(); // uid -> { scores, statsByYear }
for (const uid of affectedUids) {
  const scores = {};
  const years = new Map(); // year -> {swims,uniquePlaces,winters,abroad:Set}
  for (const s of sessions) {
    if (s.uid !== uid) continue;
    const year = String(swimYear(s.date));
    scores[year] = (scores[year] ?? 0) + (s.points ?? 0);
    let st = years.get(year);
    if (!st) {
      st = { swims: 0, uniquePlaces: 0, winters: 0, abroad: new Set() };
      years.set(year, st);
    }
    st.swims++;
    if (s.isUniqueForUser) st.uniquePlaces++;
    if (s.isWinter) st.winters++;
    if (!s.isHomeCountry && typeof s.country === "string" && s.country) {
      st.abroad.add(s.country);
    }
  }
  const statsByYear = {};
  for (const [year, st] of years) {
    statsByYear[year] = {
      swims: st.swims,
      uniquePlaces: st.uniquePlaces,
      winters: st.winters,
      countriesAbroad: st.abroad.size,
    };
  }
  scoreUpdates.set(uid, { scores, statsByYear });
}

// 4. Restamp the kept places' denormalised fields from the merged sessions.
const placeUpdates = new Map(); // placeId -> partial update
for (const { from, to } of pairs) {
  const kept = places.get(to);
  const dup = places.get(from);
  const upd = {};
  let last = null;
  for (const s of sessions) {
    if (s.placeId === to && (!last || s.date > last.date)) last = s;
  }
  if (last && last.date !== kept.lastSwimAt) {
    upd.lastSwimAt = last.date;
    upd.lastSwimBy = last.uid;
    upd.lastSwimBorder = last.border ?? "none";
  }
  if (dup?.firstSwumAt && dup.firstSwumAt < (kept.firstSwumAt ?? Infinity)) {
    upd.firstSwumAt = dup.firstSwumAt;
  }
  if (Object.keys(upd).length) placeUpdates.set(to, upd);
}

// 5. Re-key want-to-swim bookmarks pointing at a duplicate.
const toswimUpdates = new Map(); // uid -> field-path update
for (const u of usersSnap.docs) {
  const toswim = u.data().toswim;
  if (!toswim) continue;
  const upd = {};
  for (const [from, to] of targetOf) {
    const entry = toswim[from];
    if (!entry) continue;
    upd[`toswim.${from}`] = FieldValue.delete();
    const existing = toswim[to];
    if (!existing || entry.addedAt < existing.addedAt) {
      upd[`toswim.${to}`] = entry;
    }
  }
  if (Object.keys(upd).length) toswimUpdates.set(u.id, upd);
}

console.log(
  `\nPlan: retarget ${moved} session(s), ${sessionUpdates.size} session ` +
    `write(s) total, rescore ${scoreUpdates.size} user(s), restamp ` +
    `${placeUpdates.size} place(s), re-key ${toswimUpdates.size} ` +
    `toswim list(s), delete ${pairs.filter((p) => places.has(p.from)).length} place(s).`,
);
for (const [uid, { scores }] of scoreUpdates) {
  const u = usersSnap.docs.find((d) => d.id === uid);
  console.log(
    `  scores: ${u?.data().displayName ?? uid} ` +
      `${JSON.stringify(u?.data().scores ?? {})} -> ${JSON.stringify(scores)}`,
  );
}

if (!WRITE) {
  console.log("\nDry run — pass --write to commit.");
  process.exit(0);
}

// Sessions first, the duplicate place's deletion last, so a re-run after a
// partial failure still sees the sessions to fix.
for (const [id, upd] of sessionUpdates) {
  await db.collection("sessions").doc(id).update(upd);
}
for (const [uid, { scores, statsByYear }] of scoreUpdates) {
  await db.collection("users").doc(uid).update({ scores, statsByYear });
}
for (const [uid, upd] of toswimUpdates) {
  await db.collection("users").doc(uid).update(upd);
}
for (const [id, upd] of placeUpdates) {
  await db.collection("places").doc(id).update(upd);
}
for (const { from } of pairs) {
  if (places.has(from)) await db.collection("places").doc(from).delete();
}

console.log("Done.");
process.exit(0);
