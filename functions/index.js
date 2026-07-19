import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { getAuth } from "firebase-admin/auth";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import {
  swimYear,
  isWinterMonth,
  yearBounds,
  swimPoints,
  sumYearPoints,
  yearStats,
} from "./scoring.js";
import { leaderboardEntry, applyToTop, removeFromTop } from "./leaderboard.js";
import { checkTextAllowed } from "./moderation.js";

initializeApp();

const PROJECT_REGION = "europe-west1";

// Perspective API key for text moderation in logSession. Set it once with
//   firebase functions:secrets:set PERSPECTIVE_API_KEY
// before deploying; when unset (e.g. emulators) moderation is skipped.
const perspectiveApiKey = defineSecret("PERSPECTIVE_API_KEY");

// Throttle: how recent a stored reading has to be to be considered
// "fresh enough" — we won't re-fetch from the upstream API during this
// window. Independent of the client-side "is the reading stale?" check
// (which the UI does at 60 min).
const FRESH_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// The app only *displays* temps younger than a week (WEEK_MS in the
// client). When an official reading is older than this we prefer a fresh
// Open-Meteo reading so the spot keeps showing a temperature.
const DISPLAY_FRESH_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Per-user soft cap on refresh calls so a misbehaving client can't spin
// the upstream API for free.
const PER_USER_PER_HOUR = 60;

const DETAIL_URL = (nutsCode) =>
  `https://badplatsen.havochvatten.se/badplatsen/api/detail/${encodeURIComponent(nutsCode)}`;

async function fetchHavochvattenTemp(nutsCode) {
  const res = await fetch(DETAIL_URL(nutsCode), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const raw =
    data?.sampleTemperature ??
    data?.value ??
    data?.temperature ??
    data?.celsius;
  const temp = typeof raw === "string" ? Number(raw) : raw;
  const stampRaw =
    data?.sampleDate ?? data?.date ?? data?.timestamp ?? data?.measuredAt;
  const stamp =
    typeof stampRaw === "number" ? stampRaw : Date.parse(stampRaw ?? "");
  if (
    typeof temp !== "number" ||
    Number.isNaN(temp) ||
    temp < -5 ||
    temp > 40 ||
    !stamp ||
    Number.isNaN(stamp)
  ) {
    return null;
  }
  return { temp, stamp, source: "havochvatten" };
}

// Open-Meteo's marine model is sea/ocean-only — its grid has no values
// over inland lakes, so a lake coordinate returns null sea_surface_temperature.
// That's expected: lake spots without an official reading just show no temp.
const OPEN_METEO_URL = (lat, lng) =>
  `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&current=sea_surface_temperature`;

async function fetchOpenMeteoTemp(lat, lng) {
  const res = await fetch(OPEN_METEO_URL(lat, lng), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const temp = data?.current?.sea_surface_temperature;
  const timeStr = data?.current?.time;
  if (typeof temp !== "number" || Number.isNaN(temp) || temp < -5 || temp > 40)
    return null;
  const stamp = timeStr ? Date.parse(timeStr) : null;
  if (!stamp || Number.isNaN(stamp)) return null;
  return { temp, stamp, source: "open-meteo" };
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

// Parameter ids and station lists barely change; cache them per-instance
// instead of re-fetching on every single refresh call.
const SMHI_METADATA_CACHE_MS = 6 * 60 * 60 * 1000;
let smhiParameterIdCache = null; // { at: number, id: string | null }
let smhiStationsCache = null; // { at: number, stations: {id, lat, lng}[] }

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
  const now = Date.now();
  if (
    smhiParameterIdCache &&
    now - smhiParameterIdCache.at < SMHI_METADATA_CACHE_MS
  ) {
    return smhiParameterIdCache.id;
  }
  const res = await fetch(SMHI_PARAMETER_LIST_URL, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return smhiParameterIdCache?.id ?? null;
  const data = await res.json();
  const match = (data?.resource ?? []).find((r) =>
    String(r.title ?? "")
      .toLowerCase()
      .includes("havstemperatur"),
  );
  const id = match?.key ?? null;
  smhiParameterIdCache = { at: now, id };
  return id;
}

async function fetchSmhiStations(parameterId) {
  const now = Date.now();
  if (
    smhiStationsCache &&
    now - smhiStationsCache.at < SMHI_METADATA_CACHE_MS
  ) {
    return smhiStationsCache.stations;
  }
  const res = await fetch(SMHI_STATIONS_URL(parameterId), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return smhiStationsCache?.stations ?? [];
  const data = await res.json();
  // Single pass: skip inactive stations and ones missing an id/coords,
  // mapping the rest — avoids three separate traversals of the station list.
  const stations = [];
  for (const s of data?.station ?? []) {
    if (s.active === false) continue;
    if (
      s.id == null ||
      typeof s.latitude !== "number" ||
      typeof s.longitude !== "number"
    ) {
      continue;
    }
    stations.push({ id: s.id, lat: s.latitude, lng: s.longitude });
  }
  smhiStationsCache = { at: now, stations };
  return stations;
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

async function fetchSmhiTemp(lat, lng) {
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
  // Don't assume ordering — take the most recent sample's own timestamp,
  // never "now" (the fetch time).
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
  return { temp, stamp, source: "smhi" };
}

/**
 * Callable: refresh a single place's water temperature on demand.
 *
 *   data: { placeId: string }
 *   returns: { status: "updated" | "fresh" | "no-data", waterTemp?, waterTempAt? }
 *
 * The reading is written to `placeTemps/{placeId}` — never to the place
 * doc, whose whole-collection listener would fan the write out to every
 * connected client. Only the open spot subscribes to placeTemps, so the
 * refresh reaches exactly the viewer who asked for it; everyone else keeps
 * the daily `tempSummary/current` reading.
 *
 * Skips the upstream call entirely when the stored reading (or the last
 * fetch attempt, for spots whose feeds keep coming back empty) is < 15 min
 * old. Tracks per-user invocations in `refreshUsage/{uid}` so a runaway
 * client maxes out at 60/hour.
 */
export const refreshPlaceTemp = onCall(
  {
    region: PROJECT_REGION,
    cors: true,
    invoker: "public",
    // Modest concurrency; this is a thin proxy.
    maxInstances: 5,
    memory: "256MiB",
    timeoutSeconds: 30,
  },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    const placeId = req.data?.placeId;
    if (typeof placeId !== "string" || !placeId) {
      throw new HttpsError("invalid-argument", "placeId is required.");
    }

    const db = getFirestore();

    // Per-user throttle.
    const usageRef = db.collection("refreshUsage").doc(req.auth.uid);
    const usageSnap = await usageRef.get();
    const usage = usageSnap.exists ? usageSnap.data() : null;
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const recentCalls = (usage?.calls ?? []).filter((t) => t > hourAgo);
    if (recentCalls.length >= PER_USER_PER_HOUR) {
      throw new HttpsError(
        "resource-exhausted",
        `Too many refresh requests — please wait a bit.`,
      );
    }
    await usageRef.set({ calls: [...recentCalls, now] }, { merge: true });

    // The place doc is still needed for the upstream preference + coords,
    // but the reading itself lives in placeTemps/{placeId}.
    const placeRef = db.collection("places").doc(placeId);
    const tempRef = db.collection("placeTemps").doc(placeId);
    const [placeSnap, tempSnap] = await Promise.all([
      placeRef.get(),
      tempRef.get(),
    ]);
    if (!placeSnap.exists) {
      throw new HttpsError("not-found", "Place doesn't exist.");
    }
    const place = placeSnap.data();
    const stored = tempSnap.exists ? tempSnap.data() : null;
    // A recent fetch attempt (reading or not) means there's nothing newer
    // upstream — don't hit the APIs again yet.
    const recentlyChecked =
      typeof stored?.checkedAt === "number" &&
      now - stored.checkedAt < FRESH_WINDOW_MS;
    if (
      recentlyChecked ||
      (typeof stored?.at === "number" && now - stored.at < FRESH_WINDOW_MS)
    ) {
      return typeof stored?.at === "number"
        ? { status: "fresh", waterTemp: stored.t, waterTempAt: stored.at }
        : { status: "no-data" };
    }

    // Decide the preferred upstream. Fall back to the legacy `source`
    // field for places seeded before `tempSource` existed.
    const tempSource =
      place.tempSource ??
      (place.source === "havochvatten.se" ? "havochvatten" : "open-meteo");

    // Try the official/in-situ feed(s) for the preferred source. Hav och
    // Vatten baths often have no live sensor, so when that comes back
    // empty (or stale) we also try the nearest SMHI station before
    // falling back to Open-Meteo — whichever official reading is more
    // recent wins.
    let official = null;
    if (tempSource === "havochvatten" && place.externalId) {
      try {
        official = await fetchHavochvattenTemp(place.externalId);
      } catch (e) {
        logger.warn("upstream fetch failed", { placeId, error: String(e) });
      }
    }
    const wantsSmhi =
      tempSource === "smhi" ||
      (tempSource === "havochvatten" &&
        (!official || now - official.stamp > DISPLAY_FRESH_MS));
    if (
      wantsSmhi &&
      typeof place.lat === "number" &&
      typeof place.lng === "number"
    ) {
      try {
        const smhi = await fetchSmhiTemp(place.lat, place.lng);
        if (smhi && (!official || smhi.stamp > official.stamp)) {
          official = smhi;
        }
      } catch (e) {
        logger.warn("smhi fetch failed", { placeId, error: String(e) });
      }
    }

    // A fresh official reading wins. But the app only displays temps
    // younger than a week, so when the official sample is missing or stale
    // we fall back to Open-Meteo (always "now") to keep the spot showing a
    // temp. Inland lakes get nothing from Open-Meteo, so a stale official
    // reading is kept as a last resort.
    let reading =
      official && now - official.stamp <= DISPLAY_FRESH_MS ? official : null;
    if (
      !reading &&
      typeof place.lat === "number" &&
      typeof place.lng === "number"
    ) {
      try {
        reading = await fetchOpenMeteoTemp(place.lat, place.lng);
      } catch (e) {
        logger.warn("open-meteo fetch failed", { placeId, error: String(e) });
      }
    }
    if (!reading) reading = official; // stale official as last resort

    if (!reading) {
      // Still record the attempt so we don't hammer immediately again.
      await tempRef.set({ placeId, checkedAt: now }, { merge: true });
      return { status: "no-data" };
    }

    // t/at/p is the compact reading shape shared with tempSummary/current
    // (see functions/tempLogic.js).
    await tempRef.set(
      {
        placeId,
        t: reading.temp,
        at: reading.stamp,
        p: reading.source,
        checkedAt: now,
      },
      { merge: true },
    );
    // Hav och Vatten had nothing (or nothing fresh) and SMHI actually
    // supplied the reading — prefer SMHI going forward instead of paying
    // for a Hav och Vatten call that keeps coming back empty. This is the
    // one remaining place-doc write: a once-ever flip, not reading churn.
    if (
      tempSource === "havochvatten" &&
      reading.source === "smhi" &&
      place.tempSource !== "smhi"
    ) {
      await placeRef.update({ tempSource: "smhi" });
    }

    return {
      status: "updated",
      waterTemp: reading.temp,
      waterTempAt: reading.stamp,
      provider: reading.source,
    };
  },
);

// Max length for a place's `info` text. Matches INFO_MAX_CHARS in
// scripts/update-temperatures.mjs — keep in sync.
const PLACE_INFO_MAX_CHARS = 1200;

// Minimum total points (summed across every year) before a user may
// contribute place info or toggle the naturist flag — keeps fresh
// throwaway accounts from editing spot pages. Matches MIN_INFO_POINTS
// in src/lib/data.ts — keep in sync.
const MIN_INFO_POINTS = 20;

/**
 * Callable: add, edit, or clear (info = null) a place's description,
 * and/or flag the spot as a naturist (nude) bath.
 *
 *   data: { placeId: string, info?: string | null, nude?: boolean }
 *   returns: { ok: true, info: string | null, nude: boolean }
 *
 * Who may write what (everyone below also needs MIN_INFO_POINTS total
 * points — admins are exempt):
 *   - anyone may ADD info to a place that has none;
 *   - the author may edit/remove their own contribution;
 *   - admins may edit/remove anything (moderation);
 *   - official synced info (infoSource !== "user", owned by the
 *     temperature/info sync job) is read-only for non-admins;
 *   - the nude flag only needs the points bar, no info ownership. An
 *     unflag is stored as an explicit `false` (not a delete) so a rerun
 *     of the one-shot naturism.se seed won't silently re-flag it.
 *
 * Omitting `info` leaves the description untouched (nude-only update);
 * `info: null` clears it. The text gets the same authoritative
 * Perspective moderation as swim notes (fails open on outages). The
 * client-side pre-check is just UX.
 */
export const setPlaceInfo = onCall(
  {
    region: PROJECT_REGION,
    cors: true,
    invoker: "public",
    maxInstances: 10,
    memory: "256MiB",
    timeoutSeconds: 30,
    secrets: [perspectiveApiKey],
  },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    const uid = req.auth.uid;
    const d = req.data ?? {};
    const placeId = d.placeId;
    if (typeof placeId !== "string" || !placeId) {
      throw new HttpsError("invalid-argument", "placeId is required.");
    }
    const hasInfoField = d.info !== undefined;
    let info = null;
    if (hasInfoField && d.info !== null) {
      if (typeof d.info !== "string" || d.info.length > 4000) {
        throw new HttpsError("invalid-argument", "info looks invalid.");
      }
      // Same whitespace normalisation as the sync script applies to the
      // official text: collapse runs, keep paragraph breaks, cap length.
      info =
        d.info
          .replace(/\r\n?/g, "\n")
          .replace(/[^\S\n]+/g, " ")
          .replace(/ ?\n ?/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim()
          .slice(0, PLACE_INFO_MAX_CHARS) || null;
    }
    if (d.nude !== undefined && typeof d.nude !== "boolean") {
      throw new HttpsError("invalid-argument", "nude looks invalid.");
    }
    const nude = typeof d.nude === "boolean" ? d.nude : null;
    if (!hasInfoField && nude === null) {
      throw new HttpsError("invalid-argument", "Nothing to update.");
    }

    const db = getFirestore();
    const placeRef = db.collection("places").doc(placeId);
    const [placeSnap, userSnap] = await Promise.all([
      placeRef.get(),
      db.collection("users").doc(uid).get(),
    ]);
    if (!placeSnap.exists) {
      throw new HttpsError("not-found", "Place doesn't exist.");
    }
    if (!userSnap.exists) {
      throw new HttpsError("failed-precondition", "No profile yet.");
    }
    const place = placeSnap.data();
    const user = userSnap.data();
    const isAdmin = user.isAdmin === true;
    const totalPoints = Object.values(user.scores ?? {}).reduce(
      (sum, v) => sum + (typeof v === "number" ? v : 0),
      0,
    );
    if (!isAdmin && totalPoints < MIN_INFO_POINTS) {
      throw new HttpsError(
        "permission-denied",
        "Not enough points to edit spot pages yet.",
      );
    }
    const ownsExisting = place.infoSource === "user" && place.infoBy === uid;
    if (hasInfoField && !isAdmin && place.info && !ownsExisting) {
      throw new HttpsError("permission-denied", "This place already has info.");
    }

    const updates = {};
    // An unchanged text is a no-op (e.g. a nude-only toggle from the
    // editor) — don't re-attribute someone else's or official text.
    if (hasInfoField && info && info !== place.info) {
      const modKey = perspectiveApiKey.value();
      if (modKey && !(await checkTextAllowed(info, modKey))) {
        logger.info("setPlaceInfo rejected by moderation", { uid, placeId });
        throw new HttpsError(
          "invalid-argument",
          "Text rejected by moderation.",
          { reason: "moderation" },
        );
      }
      Object.assign(updates, {
        info,
        infoSource: "user",
        infoBy: uid,
        infoByName: user.displayName ?? "Swimmer",
        infoUpdatedAt: Date.now(),
        // A user rewrite replaces any official link/attribution.
        infoUrl: FieldValue.delete(),
      });
    } else if (hasInfoField && !info && place.info) {
      Object.assign(updates, {
        info: FieldValue.delete(),
        infoSource: FieldValue.delete(),
        infoUrl: FieldValue.delete(),
        infoBy: FieldValue.delete(),
        infoByName: FieldValue.delete(),
        infoUpdatedAt: FieldValue.delete(),
      });
    }
    if (nude !== null && nude !== (place.nude === true)) {
      updates.nude = nude;
      updates.nudeSource = "user";
    }
    if (Object.keys(updates).length > 0) {
      // Advance the delta cursor so the edit (notably a naturist-flag toggle,
      // which the map reads) reaches every client before the next nightly
      // placesSummary build. See PlacesSummaryDoc in src/lib/types.ts.
      updates.updatedAt = Date.now();
      await placeRef.update(updates);
    }
    return {
      ok: true,
      info: hasInfoField ? info : (place.info ?? null),
      nude: nude ?? place.nude === true,
    };
  },
);

/**
 * Callable: preview a group by its share code — no side effects.
 *
 *   data: { code: string }
 *   returns: { id, name, emoji?, memberCount } | null (not-found → null)
 *
 * Used to show a "Do you want to join X?" confirmation before the user
 * commits. Group docs are not client-readable for non-members so we need
 * the Admin SDK here as well.
 */
export const lookupGroupByCode = onCall(
  {
    region: PROJECT_REGION,
    cors: true,
    invoker: "public",
    maxInstances: 5,
    memory: "256MiB",
    timeoutSeconds: 10,
  },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    const raw = req.data?.code;
    if (typeof raw !== "string") {
      throw new HttpsError("invalid-argument", "code is required.");
    }
    const code = raw.trim().toUpperCase();
    if (code.length < 3 || code.length > 12) {
      throw new HttpsError("invalid-argument", "code looks invalid.");
    }

    const db = getFirestore();
    const matches = await db
      .collection("groups")
      .where("code", "==", code)
      .limit(1)
      .get();

    if (matches.empty) {
      throw new HttpsError("not-found", "No group with that code.");
    }

    const data = matches.docs[0].data();
    return {
      id: matches.docs[0].id,
      name: data.name,
      emoji: data.emoji ?? null,
      memberCount: Array.isArray(data.members) ? data.members.length : 0,
    };
  },
);

/**
 * Callable: leave a group.
 *
 *   data: { groupId: string }
 *
 * Three cases handled atomically:
 *   1. Last member leaves  → group is deleted.
 *   2. Founder leaves, others remain → ownership transferred to the first
 *      remaining member (sorted by join order in the members array).
 *   3. Regular member leaves → just removed from the members array.
 */
export const leaveGroup = onCall(
  {
    region: PROJECT_REGION,
    cors: true,
    invoker: "public",
    maxInstances: 5,
    memory: "256MiB",
    timeoutSeconds: 15,
  },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    const groupId = req.data?.groupId;
    if (typeof groupId !== "string" || !groupId) {
      throw new HttpsError("invalid-argument", "groupId is required.");
    }

    const db = getFirestore();
    const groupRef = db.collection("groups").doc(groupId);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(groupRef);
      if (!snap.exists) {
        throw new HttpsError("not-found", "Group not found.");
      }
      const data = snap.data();
      const uid = req.auth.uid;

      if (!Array.isArray(data.members) || !data.members.includes(uid)) {
        throw new HttpsError(
          "permission-denied",
          "Not a member of this group.",
        );
      }

      const remaining = data.members.filter((m) => m !== uid);

      if (remaining.length === 0) {
        // Last person out — delete the group entirely.
        tx.delete(groupRef);
      } else if (data.createdBy === uid) {
        // Founder leaving — hand ownership to the first remaining member.
        tx.update(groupRef, {
          members: remaining,
          createdBy: remaining[0],
        });
      } else {
        // Regular member — just remove them.
        tx.update(groupRef, {
          members: FieldValue.arrayRemove(uid),
        });
      }
    });
  },
);

/**
 * Callable: join a group by its share code.
 *
 *   data: { code: string }
 *   returns: { id, name, emoji?, code, members: string[], createdBy, createdAt }
 *
 * Group docs are no longer client-readable unless you're already a
 * member, so the only way to look up a group by code is via this
 * function (which uses the Admin SDK and bypasses rules). Adds the
 * caller to `group.members` and to the user's `groups` array atomically.
 */
export const joinGroupByCode = onCall(
  {
    region: PROJECT_REGION,
    cors: true,
    invoker: "public",
    maxInstances: 5,
    memory: "256MiB",
    timeoutSeconds: 15,
  },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    const raw = req.data?.code;
    if (typeof raw !== "string") {
      throw new HttpsError("invalid-argument", "code is required.");
    }
    const code = raw.trim().toUpperCase();
    if (code.length < 3 || code.length > 12) {
      throw new HttpsError("invalid-argument", "code looks invalid.");
    }

    const db = getFirestore();
    const matches = await db
      .collection("groups")
      .where("code", "==", code)
      .limit(1)
      .get();

    if (matches.empty) {
      throw new HttpsError("not-found", "No group with that code.");
    }

    const groupRef = matches.docs[0].ref;
    const data = matches.docs[0].data();
    const uid = req.auth.uid;

    if (Array.isArray(data.members) && data.members.includes(uid)) {
      // Already a member — just return the doc so the client can refresh state.
      return { id: groupRef.id, ...data };
    }

    await groupRef.update({ members: FieldValue.arrayUnion(uid) });

    return {
      id: groupRef.id,
      ...data,
      members: [...(data.members ?? []), uid],
    };
  },
);

/**
 * Callable: log a swim. This is the ONLY way a session is created —
 * Firestore rules forbid clients from writing the sessions collection or
 * the user's `scores` directly, so points can't be forged.
 *
 *   data: { placeId, placeName, lat, lng, date, note?, country?,
 *           photoUrl?, photoPath?, photoThumb? }
 *   returns: { id, points, isUniqueForUser, isWinter }
 *
 * The photo (if any) is uploaded to Storage by the client first; we just
 * record its URL/path. Scoring + the per-year running total on the user
 * are updated atomically in a transaction. The year total is *recomputed*
 * from the user's sessions (not blindly incremented) so it self-heals even
 * if a previous write was lost.
 */
export const logSession = onCall(
  {
    region: PROJECT_REGION,
    cors: true,
    invoker: "public",
    maxInstances: 10,
    memory: "256MiB",
    timeoutSeconds: 30,
    secrets: [perspectiveApiKey],
  },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    const uid = req.auth.uid;
    const d = req.data ?? {};

    const placeId = d.placeId;
    const placeName = d.placeName;
    const { lat, lng, date } = d;
    if (typeof placeId !== "string" || !placeId) {
      throw new HttpsError("invalid-argument", "placeId is required.");
    }
    if (
      typeof placeName !== "string" ||
      !placeName.trim() ||
      placeName.length > 80
    ) {
      throw new HttpsError("invalid-argument", "placeName looks invalid.");
    }
    if (
      typeof lat !== "number" ||
      typeof lng !== "number" ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      throw new HttpsError("invalid-argument", "Coordinates look invalid.");
    }
    if (
      typeof date !== "number" ||
      date < 946684800000 || // 2000-01-01
      date > Date.now() + 86400000
    ) {
      throw new HttpsError("invalid-argument", "date looks invalid.");
    }
    const note =
      typeof d.note === "string" && d.note.trim()
        ? d.note.trim().slice(0, 500)
        : null;
    const country =
      typeof d.country === "string" && d.country.length <= 3 ? d.country : null;
    const photoUrl = typeof d.photoUrl === "string" ? d.photoUrl : null;
    const photoPath = typeof d.photoPath === "string" ? d.photoPath : null;
    // Tiny inline LQIP placeholder (base64 data URL). Optional; reject
    // anything that isn't a short string so a client can't bloat the doc.
    if (d.photoThumb !== undefined && d.photoThumb !== null) {
      if (typeof d.photoThumb !== "string" || d.photoThumb.length > 4000) {
        throw new HttpsError("invalid-argument", "photoThumb looks invalid.");
      }
    }
    const photoThumb =
      typeof d.photoThumb === "string" && d.photoThumb.length <= 4000
        ? d.photoThumb
        : null;
    // The swimmer's chosen border at log time — denormalised onto the place
    // so the map can outline each pin with the last swimmer's frame without
    // loading any sessions. "none" means no frame.
    const border =
      typeof d.border === "string" && d.border.length <= 20 ? d.border : "none";

    // Authoritative moderation of user-supplied text (the client-side
    // check in src/lib/moderation.ts is just UX and can be bypassed).
    // checkTextAllowed fails open on API errors/timeouts, so an outage
    // never blocks legitimate swims. Kept outside the transaction —
    // network calls don't belong in one.
    const modKey = perspectiveApiKey.value();
    if (modKey) {
      const [nameOk, noteOk] = await Promise.all([
        checkTextAllowed(placeName, modKey),
        note ? checkTextAllowed(note, modKey) : true,
      ]);
      if (!nameOk || !noteOk) {
        logger.info("logSession rejected by moderation", { uid });
        throw new HttpsError(
          "invalid-argument",
          "Text rejected by moderation.",
          { reason: "moderation" },
        );
      }
    }

    const db = getFirestore();
    const userRef = db.collection("users").doc(uid);
    const sessionsCol = db.collection("sessions");
    const newRef = sessionsCol.doc();
    const year = swimYear(date);
    const [yStart, yEnd] = yearBounds(year);
    const leaderboardRef = db.collection("leaderboard").doc(String(year));

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before any writes) ──
      const [userSnap, dupSnap, yearSnap, lbSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(
          sessionsCol
            .where("uid", "==", uid)
            .where("placeId", "==", placeId)
            .limit(1),
        ),
        tx.get(
          sessionsCol
            .where("uid", "==", uid)
            .where("date", ">=", yStart)
            .where("date", "<", yEnd)
            // orderBy matches the existing (uid, date DESC) composite index;
            // without it Firestore demands a separate (uid, date ASC) index.
            .orderBy("date", "desc"),
        ),
        tx.get(leaderboardRef),
      ]);
      if (!userSnap.exists) {
        throw new HttpsError("failed-precondition", "No profile yet.");
      }
      const user = userSnap.data();

      // ── compute ──
      const isUniqueForUser = dupSnap.empty;
      const isWinter = isWinterMonth(date);
      const points = swimPoints(isUniqueForUser, isWinter);
      const homeCountry = user.homeCountry ?? null;
      const isHomeCountry = !!(
        homeCountry &&
        homeCountry !== "OTHER" &&
        country &&
        country === homeCountry
      );
      const yearTotal = sumYearPoints(yearSnap) + points;

      const session = {
        id: newRef.id,
        uid,
        displayName: user.displayName ?? "Swimmer",
        placeId,
        placeName: placeName.trim(),
        lat,
        lng,
        date,
        points,
        isUniqueForUser,
        isWinter,
        isHomeCountry,
        createdAt: Date.now(),
      };
      if (note) session.note = note;
      if (country) session.country = country;
      if (photoUrl) session.photoUrl = photoUrl;
      if (photoPath) session.photoPath = photoPath;
      if (photoThumb) session.photoThumb = photoThumb;
      session.border = border;

      const stats = yearStats(yearSnap, { extra: session });

      // ── writes ──
      tx.set(newRef, {
        ...session,
        createdAtServer: FieldValue.serverTimestamp(),
      });
      tx.update(userRef, {
        [`scores.${year}`]: yearTotal,
        [`statsByYear.${year}`]: stats,
      });
      // Keep the world-readable top-5 snapshot in sync so guests see this
      // swimmer's fresh total (see functions/leaderboard.js).
      tx.set(
        leaderboardRef,
        {
          year,
          top: applyToTop(
            lbSnap.exists ? (lbSnap.data().top ?? []) : [],
            leaderboardEntry(uid, user, yearTotal, stats),
          ),
          updatedAt: Date.now(),
        },
        { merge: true },
      );
      // The place's "last swim" frame is no longer denormalised here — the
      // daily placesSummary build derives it from sessions. logSession no
      // longer touches the place doc, so a swim never re-streams it to every
      // client on the `places`/summary listeners.

      return { id: newRef.id, points, isUniqueForUser, isWinter };
    });

    return result;
  },
);

/**
 * Callable: remove a swim. The owner may remove their own; an admin may
 * remove anyone's (moderation). Deletes the session, recomputes the
 * owner's per-year score, and removes the photo from Storage.
 *
 *   data: { sessionId: string }
 *   returns: { ok: true }
 */
export const removeSession = onCall(
  {
    region: PROJECT_REGION,
    cors: true,
    invoker: "public",
    maxInstances: 10,
    memory: "256MiB",
    timeoutSeconds: 30,
  },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    const callerUid = req.auth.uid;
    const sessionId = req.data?.sessionId;
    if (typeof sessionId !== "string" || !sessionId) {
      throw new HttpsError("invalid-argument", "sessionId is required.");
    }

    const db = getFirestore();
    const sessionRef = db.collection("sessions").doc(sessionId);

    const photoPath = await db.runTransaction(async (tx) => {
      // ── reads ──
      const sessionSnap = await tx.get(sessionRef);
      if (!sessionSnap.exists) {
        throw new HttpsError("not-found", "Session not found.");
      }
      const session = sessionSnap.data();
      const ownerUid = session.uid;
      const isOwner = ownerUid === callerUid;

      let allowed = isOwner;
      if (!isOwner) {
        const callerSnap = await tx.get(db.collection("users").doc(callerUid));
        allowed = callerSnap.exists && callerSnap.data().isAdmin === true;
      }
      if (!allowed) {
        throw new HttpsError(
          "permission-denied",
          "Not allowed to remove this session.",
        );
      }

      const ownerRef = db.collection("users").doc(ownerUid);
      const ownerSnap = await tx.get(ownerRef);
      const year = swimYear(session.date);
      const [yStart, yEnd] = yearBounds(year);
      const yearSnap = await tx.get(
        db
          .collection("sessions")
          .where("uid", "==", ownerUid)
          .where("date", ">=", yStart)
          .where("date", "<", yEnd)
          // Reuse the existing (uid, date DESC) index — see logSession.
          .orderBy("date", "desc"),
      );
      const leaderboardRef = db.collection("leaderboard").doc(String(year));
      const lbSnap = await tx.get(leaderboardRef);

      // ── writes ──
      const yearTotal = sumYearPoints(yearSnap, sessionId);
      tx.delete(sessionRef);
      if (ownerSnap.exists) {
        const stats = yearStats(yearSnap, { excludeId: sessionId });
        tx.update(ownerRef, {
          [`scores.${year}`]: Math.max(0, yearTotal),
          [`statsByYear.${year}`]: stats,
        });
        // Keep the world-readable top-5 snapshot in sync with the lower total.
        tx.set(
          leaderboardRef,
          {
            year,
            top: applyToTop(
              lbSnap.exists ? (lbSnap.data().top ?? []) : [],
              leaderboardEntry(
                ownerUid,
                ownerSnap.data(),
                Math.max(0, yearTotal),
                stats,
              ),
            ),
            updatedAt: Date.now(),
          },
          { merge: true },
        );
      }
      // The place's "last swim" frame is derived from sessions by the daily
      // placesSummary build, so removeSession no longer restamps the place doc.
      return session.photoPath ?? null;
    });

    // Best-effort photo cleanup, outside the transaction.
    if (photoPath) {
      try {
        await getStorage().bucket().file(photoPath).delete();
      } catch (e) {
        logger.warn("photo delete failed", { sessionId, error: String(e) });
      }
    }

    return { ok: true };
  },
);

/**
 * Callable: edit a swim. Owner only — the editable fields are the date, the
 * note, and the photo (place and coordinates are fixed; log a new swim for a
 * different spot). Recomputes what depends on the date — isWinter, points,
 * and the owner's per-year score/stats (both years when the edit crosses a
 * year boundary) — inside a transaction, same self-healing recompute as
 * logSession/removeSession. A replaced/removed photo's storage object is
 * cleaned up best-effort afterwards.
 *
 *   data: { sessionId: string,
 *           date?: number,                       // omit = keep
 *           note?: string | null,                // omit = keep, null = clear
 *           photo?: { url, path, thumb? } | null // omit = keep, null = remove
 *         }
 *   returns: { ok: true, points: number, isWinter: boolean }
 */
export const updateSession = onCall(
  {
    region: PROJECT_REGION,
    cors: true,
    invoker: "public",
    maxInstances: 10,
    memory: "256MiB",
    timeoutSeconds: 30,
    secrets: [perspectiveApiKey],
  },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    const callerUid = req.auth.uid;
    const d = req.data ?? {};
    const sessionId = d.sessionId;
    if (typeof sessionId !== "string" || !sessionId) {
      throw new HttpsError("invalid-argument", "sessionId is required.");
    }

    // date: omitted = keep. Same bounds as logSession.
    let newDate = null;
    if (d.date !== undefined) {
      if (
        typeof d.date !== "number" ||
        d.date < 946684800000 || // 2000-01-01
        d.date > Date.now() + 86400000
      ) {
        throw new HttpsError("invalid-argument", "date looks invalid.");
      }
      newDate = d.date;
    }

    // note: omitted = keep, null (or blank) = clear, string = replace.
    const hasNote = d.note !== undefined;
    let note = null;
    if (hasNote && d.note !== null) {
      if (typeof d.note !== "string" || d.note.length > 2000) {
        throw new HttpsError("invalid-argument", "note looks invalid.");
      }
      note = d.note.trim().slice(0, 500) || null;
    }

    // photo: omitted = keep, null = remove, { url, path, thumb? } = replace
    // (the client uploads the new object to Storage first, like logSession).
    const hasPhoto = d.photo !== undefined;
    let photo = null;
    if (hasPhoto && d.photo !== null) {
      const p = d.photo;
      if (
        typeof p !== "object" ||
        typeof p.url !== "string" ||
        !p.url ||
        typeof p.path !== "string" ||
        !p.path
      ) {
        throw new HttpsError("invalid-argument", "photo looks invalid.");
      }
      if (
        p.thumb !== undefined &&
        p.thumb !== null &&
        (typeof p.thumb !== "string" || p.thumb.length > 4000)
      ) {
        throw new HttpsError("invalid-argument", "photoThumb looks invalid.");
      }
      photo = {
        url: p.url,
        path: p.path,
        thumb: typeof p.thumb === "string" ? p.thumb : null,
      };
    }

    if (newDate === null && !hasNote && !hasPhoto) {
      throw new HttpsError("invalid-argument", "Nothing to update.");
    }

    // Authoritative moderation of a changed note — same as logSession
    // (fails open on outages, outside the transaction).
    const modKey = perspectiveApiKey.value();
    if (note && modKey && !(await checkTextAllowed(note, modKey))) {
      logger.info("updateSession rejected by moderation", { uid: callerUid });
      throw new HttpsError("invalid-argument", "Text rejected by moderation.", {
        reason: "moderation",
      });
    }

    const db = getFirestore();
    const sessionRef = db.collection("sessions").doc(sessionId);
    const userRef = db.collection("users").doc(callerUid);
    const yearQuery = (year) => {
      const [yStart, yEnd] = yearBounds(year);
      return (
        db
          .collection("sessions")
          .where("uid", "==", callerUid)
          .where("date", ">=", yStart)
          .where("date", "<", yEnd)
          // Reuse the existing (uid, date DESC) index — see logSession.
          .orderBy("date", "desc")
      );
    };

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before any writes) ──
      const sessionSnap = await tx.get(sessionRef);
      if (!sessionSnap.exists) {
        throw new HttpsError("not-found", "Session not found.");
      }
      const session = sessionSnap.data();
      if (session.uid !== callerUid) {
        throw new HttpsError(
          "permission-denied",
          "Not allowed to edit this session.",
        );
      }

      const date = newDate ?? session.date;
      const year = swimYear(date);
      const oldYear = swimYear(session.date);
      const leaderboardRef = db.collection("leaderboard").doc(String(year));
      const oldLeaderboardRef =
        year === oldYear
          ? null
          : db.collection("leaderboard").doc(String(oldYear));
      const [userSnap, yearSnap, oldYearSnap, lbSnap, oldLbSnap] =
        await Promise.all([
          tx.get(userRef),
          tx.get(yearQuery(year)),
          year === oldYear ? null : tx.get(yearQuery(oldYear)),
          tx.get(leaderboardRef),
          oldLeaderboardRef ? tx.get(oldLeaderboardRef) : null,
        ]);

      // ── compute ──
      const isWinter = isWinterMonth(date);
      const points = swimPoints(session.isUniqueForUser === true, isWinter);
      // The session as it will be after the edit — feeds yearStats (which
      // only reads date-independent flags plus isWinter, so photo/note
      // changes don't matter here, but keep it faithful anyway).
      const updatedSession = { ...session, date, isWinter, points };
      if (hasNote) {
        if (note) updatedSession.note = note;
        else delete updatedSession.note;
      }

      const updates = { date, isWinter, points };
      if (hasNote) {
        updates.note = note ?? FieldValue.delete();
      }
      let removedPhotoPath = null;
      if (hasPhoto) {
        if (photo) {
          updates.photoUrl = photo.url;
          updates.photoPath = photo.path;
          updates.photoThumb = photo.thumb ?? FieldValue.delete();
        } else {
          updates.photoUrl = FieldValue.delete();
          updates.photoPath = FieldValue.delete();
          updates.photoThumb = FieldValue.delete();
        }
        if (session.photoPath && session.photoPath !== photo?.path) {
          removedPhotoPath = session.photoPath;
        }
      }

      // ── writes ──
      tx.update(sessionRef, updates);
      if (userSnap.exists) {
        // Recompute from the year's sessions (excluding this one's stored
        // copy, folding the edited version back in) so the totals self-heal
        // — and both years stay right when the edit crosses a boundary.
        const user = userSnap.data();
        const newScore = Math.max(
          0,
          sumYearPoints(yearSnap, sessionId) + points,
        );
        const newStats = yearStats(yearSnap, {
          excludeId: sessionId,
          extra: updatedSession,
        });
        const userUpdates = {
          [`scores.${year}`]: newScore,
          [`statsByYear.${year}`]: newStats,
        };
        // Keep the world-readable top-5 snapshot in sync for the edited year.
        tx.set(
          leaderboardRef,
          {
            year,
            top: applyToTop(
              lbSnap.exists ? (lbSnap.data().top ?? []) : [],
              leaderboardEntry(callerUid, user, newScore, newStats),
            ),
            updatedAt: Date.now(),
          },
          { merge: true },
        );
        if (oldYearSnap) {
          const oldScore = Math.max(0, sumYearPoints(oldYearSnap, sessionId));
          const oldStats = yearStats(oldYearSnap, { excludeId: sessionId });
          userUpdates[`scores.${oldYear}`] = oldScore;
          userUpdates[`statsByYear.${oldYear}`] = oldStats;
          if (oldLeaderboardRef) {
            tx.set(
              oldLeaderboardRef,
              {
                year: oldYear,
                top: applyToTop(
                  oldLbSnap.exists ? (oldLbSnap.data().top ?? []) : [],
                  leaderboardEntry(callerUid, user, oldScore, oldStats),
                ),
                updatedAt: Date.now(),
              },
              { merge: true },
            );
          }
        }
        tx.update(userRef, userUpdates);
      }

      return { points, isWinter, removedPhotoPath };
    });

    // Best-effort cleanup of the replaced/removed photo, outside the
    // transaction — same as removeSession.
    if (result.removedPhotoPath) {
      try {
        await getStorage().bucket().file(result.removedPhotoPath).delete();
      } catch (e) {
        logger.warn("photo delete failed", { sessionId, error: String(e) });
      }
    }

    return { ok: true, points: result.points, isWinter: result.isWinter };
  },
);

/**
 * Wipe every trace of a user's data: their sessions (and photos), their
 * group memberships (transferring ownership or deleting the group as
 * needed), and their user doc. Shared by the "delete my account" flow and
 * the admin `banUser` function. Does not touch Firebase Auth — callers
 * decide whether to delete or disable the auth account afterwards.
 */
async function purgeUserData(uid) {
  const db = getFirestore();

  // Sessions (+ collect photo paths for cleanup).
  const sessions = await db
    .collection("sessions")
    .where("uid", "==", uid)
    .get();
  const photoPaths = [];
  let batch = db.batch();
  let ops = 0;
  for (const doc of sessions.docs) {
    const path = doc.data().photoPath;
    if (typeof path === "string") photoPaths.push(path);
    batch.delete(doc.ref);
    if (++ops >= 450) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();

  // Group memberships — mirror leaveGroup's 3-case handling per group.
  const groups = await db
    .collection("groups")
    .where("members", "array-contains", uid)
    .get();
  await Promise.all(
    groups.docs.map((g) => {
      const data = g.data();
      const remaining = (data.members ?? []).filter((m) => m !== uid);
      if (remaining.length === 0) return g.ref.delete();
      if (data.createdBy === uid) {
        return g.ref.update({ members: remaining, createdBy: remaining[0] });
      }
      return g.ref.update({ members: FieldValue.arrayRemove(uid) });
    }),
  );

  await db.collection("users").doc(uid).delete();

  // Drop the swimmer from any world-readable leaderboard snapshots. The
  // vacated slot is refilled by the per-year backfill job.
  const leaderboards = await db.collection("leaderboard").get();
  await Promise.all(
    leaderboards.docs.map((d) => {
      const top = d.data().top ?? [];
      if (!top.some((e) => e && e.uid === uid)) return null;
      return d.ref.set(
        { top: removeFromTop(top, uid), updatedAt: Date.now() },
        { merge: true },
      );
    }),
  );
  await Promise.all(
    photoPaths.map((p) =>
      getStorage()
        .bucket()
        .file(p)
        .delete()
        .catch(() => {}),
    ),
  );
}

/**
 * Callable: delete the caller's account data. Removes all their sessions
 * (and photos), drops them from every group (transferring ownership or
 * deleting the group when needed), and deletes the user doc. The client
 * still calls Firebase Auth's deleteUser afterwards. Sessions can't be
 * deleted client-side anymore (rules forbid it), so this runs server-side.
 */
export const deleteAccount = onCall(
  {
    region: PROJECT_REGION,
    cors: true,
    invoker: "public",
    maxInstances: 5,
    memory: "256MiB",
    timeoutSeconds: 120,
  },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    await purgeUserData(req.auth.uid);
    return { ok: true };
  },
);

/**
 * Callable (admin only): ban a user. Wipes their app data (sessions,
 * photos, group memberships, user doc) and bans them from Firebase Auth by
 * *disabling* the account — Firebase's mechanism for blocking sign-in.
 * (Deleting the auth account would let them immediately re-register.) An
 * audit record is written to `bannedUsers/{uid}` before the data is purged.
 *
 * Admins can't ban themselves or other admins.
 */
export const banUser = onCall(
  {
    region: PROJECT_REGION,
    cors: true,
    invoker: "public",
    maxInstances: 5,
    memory: "256MiB",
    timeoutSeconds: 120,
  },
  async (req) => {
    if (!req.auth) {
      throw new HttpsError("unauthenticated", "Sign in required.");
    }
    const callerUid = req.auth.uid;
    const targetUid = req.data?.uid;
    if (typeof targetUid !== "string" || !targetUid) {
      throw new HttpsError("invalid-argument", "uid is required.");
    }
    if (targetUid === callerUid) {
      throw new HttpsError("failed-precondition", "You can't ban yourself.");
    }

    const db = getFirestore();

    // Caller must be an admin (Admin SDK bypasses rules, so check here).
    const callerSnap = await db.collection("users").doc(callerUid).get();
    if (!callerSnap.exists || callerSnap.data().isAdmin !== true) {
      throw new HttpsError("permission-denied", "Admins only.");
    }

    // Don't let admins ban each other.
    const targetSnap = await db.collection("users").doc(targetUid).get();
    if (targetSnap.exists && targetSnap.data().isAdmin === true) {
      throw new HttpsError(
        "failed-precondition",
        "You can't ban another admin.",
      );
    }

    // Best-effort email lookup for the audit record before we disable.
    let email = null;
    try {
      email = (await getAuth().getUser(targetUid)).email ?? null;
    } catch (e) {
      logger.warn("auth lookup failed", { targetUid, error: String(e) });
    }

    // Audit trail — written before the user doc is deleted.
    await db
      .collection("bannedUsers")
      .doc(targetUid)
      .set({
        uid: targetUid,
        displayName: targetSnap.exists
          ? (targetSnap.data().displayName ?? null)
          : null,
        email,
        bannedAt: Date.now(),
        bannedBy: callerUid,
      });

    await purgeUserData(targetUid);

    // Ban at the Auth level: disable so they can't sign back in.
    try {
      await getAuth().updateUser(targetUid, { disabled: true });
    } catch (e) {
      logger.warn("auth disable failed", { targetUid, error: String(e) });
    }

    return { ok: true };
  },
);

// ---------------------------------------------------------------------------
// Share link previews (Open Graph / Twitter cards)
// ---------------------------------------------------------------------------
// The app is a SPA: Hosting rewrites every path to a single static index.html
// whose OG tags are generic, so link-preview scrapers (Messenger, WhatsApp,
// Slack, iMessage, X, Discord…) — which don't run our JS — render the same
// logo card for every shared place/session. This function backs the `/s/**`
// Hosting rewrite (see firebase.json) and serves *per-place / per-session* OG
// tags. Real browsers are 302'd straight into the SPA route (keeping the app's
// own `/spot/**` deep links fully static and fast); only scrapers pay for the
// Firestore reads that build the card. Share buttons emit `/s/...` URLs; the
// SPA also has a client-side `/s/:placeId` fallback for local dev where this
// function isn't running.

const CANONICAL_ORIGIN = "https://badligan.club";
const SHARE_LOGO_URL = `${CANONICAL_ORIGIN}/web-app-manifest-512x512.png`;

// Known link-preview / social scraper user-agents. Anything not matching is
// treated as a real browser and bounced into the SPA. The list is generous on
// purpose (false positives just mean a scraper-style page that still redirects
// humans via the meta-refresh + script below, so misclassification is safe).
const SHARE_CRAWLER_UA =
  /facebookexternalhit|facebookcatalog|Facebot|Twitterbot|Slackbot|Slack-ImgProxy|LinkedInBot|WhatsApp|TelegramBot|Discordbot|Pinterest|redditbot|Applebot|SkypeUriPreview|vkShare|Googlebot|Google-InspectionTool|bingbot|embedly|Iframely|Nuzzel|Qwantify|outbrain|Bitrix|XING-contenttabreceiver/i;

/** Minimal HTML-attribute escaping for values interpolated into meta tags. */
function shareEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Serialize a value for an inline script without allowing HTML breakout. */
function shareScriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

/** Collapse whitespace and clip to `max` chars on a word boundary, adding an
 *  ellipsis — keeps long spot descriptions / notes from overflowing the card. */
function shareTruncate(value, max) {
  const s = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const body = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return body.replace(/[\s.,;:!?–-]+$/, "") + "…";
}

/** The latest photo among a place's most recent swims. Scans a bounded window
 *  (most spots' recent swims include a photo; this is a preview nicety, not an
 *  exhaustive search) and returns the first photoUrl found, or null. */
function latestPhotoFrom(sessionDocs) {
  for (const doc of sessionDocs) {
    const url = doc.data().photoUrl;
    if (typeof url === "string" && url) return url;
  }
  return null;
}

export const spotPreview = onRequest(
  {
    region: PROJECT_REGION,
    invoker: "public",
    maxInstances: 10,
    memory: "256MiB",
    timeoutSeconds: 15,
  },
  async (req, res) => {
    // Path is `/s/<placeId>` (+ optional `?session=<id>`); the `/s/**` rewrite
    // passes the original URL through untouched.
    const parts = req.path.split("/").filter(Boolean);
    const placeId = parts[1] ?? "";
    const sessionId =
      typeof req.query.session === "string" ? req.query.session : "";

    // Where a real browser should end up: the static SPA deep link.
    const appPath = placeId
      ? `/spot/${encodeURIComponent(placeId)}${
          sessionId ? `?session=${encodeURIComponent(sessionId)}` : ""
        }`
      : "/";

    // Real browsers: clean server redirect into the SPA, no Firestore reads.
    const ua = req.get("user-agent") ?? "";
    if (!SHARE_CRAWLER_UA.test(ua)) {
      res.set("Cache-Control", "no-store");
      res.redirect(302, appPath);
      return;
    }

    // Scrapers: build a per-place / per-session card. Defaults cover a missing
    // or deleted target so a stale link still previews as the app itself.
    let title = "Badligan – en liten, vänlig badtävling";
    let description =
      "Logga dina bad, samla badplatser på kartan, lås upp utmärkelser och tävla med vänner om poäng.";
    let image = SHARE_LOGO_URL;
    let largeImage = false;
    let ogType = "website";

    try {
      const db = getFirestore();
      const placeSnap = placeId
        ? await db.collection("places").doc(placeId).get()
        : null;
      const place = placeSnap?.exists ? placeSnap.data() : null;
      const placeName = place?.name ?? null;

      if (sessionId) {
        // A shared swim: show its own photo and the swimmer's note (if any).
        const sessionSnap = await db
          .collection("sessions")
          .doc(sessionId)
          .get();
        const session = sessionSnap.exists ? sessionSnap.data() : null;
        if (session) {
          const where = placeName ?? session.placeName ?? "en badplats";
          ogType = "article";
          title = `${session.displayName}s bad på ${where}`;
          const note =
            typeof session.note === "string" ? session.note.trim() : "";
          description = note
            ? `”${shareTruncate(note, 180)}” – ${session.displayName} på ${where}`
            : `${session.displayName} badade på ${where}. Följ med i Badligan – logga bad, samla badplatser och tävla med vänner.`;
          // A swim photo makes a proper wide card; otherwise the logo.
          if (session.photoUrl) {
            image = session.photoUrl;
            largeImage = true;
          }
        }
      } else if (place) {
        title = `${placeName} på Badligan`;

        // Gather the extras in parallel: total swim count, a recent photo to
        // use as the card image, and the latest water temperature.
        const sessionsForPlace = db
          .collection("sessions")
          .where("placeId", "==", placeId);
        const [countSnap, recentSnap, tempSnap] = await Promise.all([
          sessionsForPlace.count().get(),
          sessionsForPlace.orderBy("date", "desc").limit(25).get(),
          db.doc("tempSummary/current").get(),
        ]);

        const swimCount = countSnap.data().count ?? 0;
        const photoUrl = latestPhotoFrom(recentSnap.docs);
        const tempEntry = tempSnap.exists
          ? tempSnap.data().entries?.[placeId]
          : null;
        const temp =
          tempEntry && typeof tempEntry.t === "number" ? tempEntry.t : null;

        // "18.3 °C i vattnet · 42 bad" — matches how the app renders both.
        const stats = [];
        if (temp != null) stats.push(`${temp.toFixed(1)} °C i vattnet`);
        if (swimCount > 0) stats.push(`${swimCount} bad`);
        const statLine = stats.join(" · ");

        // Lead with the spot's own description when it has one, then the stats.
        const info = typeof place.info === "string" ? place.info.trim() : "";
        if (info) {
          const infoText = shareTruncate(info, 160);
          description = statLine ? `${infoText} · ${statLine}` : infoText;
        } else {
          description = statLine
            ? `${statLine} · Kolla in ${placeName} på Badligan.`
            : `Kolla in ${placeName} på Badligan – logga dina bad, samla badplatser på kartan och tävla med vänner om poäng.`;
        }

        if (photoUrl) {
          image = photoUrl;
          largeImage = true;
        }
      }
    } catch (e) {
      // Fall back to the site-level defaults; a preview is better than a 500.
      logger.warn("spotPreview lookup failed", {
        placeId,
        sessionId,
        error: String(e),
      });
    }

    const shareUrl = `${CANONICAL_ORIGIN}/s/${encodeURIComponent(placeId)}${
      sessionId ? `?session=${encodeURIComponent(sessionId)}` : ""
    }`;
    const cardType = largeImage ? "summary_large_image" : "summary";
    const t = shareEscape(title);
    const d = shareEscape(description);
    const img = shareEscape(image);
    const url = shareEscape(shareUrl);
    const redirect = shareEscape(appPath);

    const html = `<!doctype html>
<html lang="sv">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${t}</title>
    <meta name="description" content="${d}" />
    <link rel="canonical" href="${url}" />
    <meta property="og:type" content="${ogType}" />
    <meta property="og:site_name" content="Badligan" />
    <meta property="og:title" content="${t}" />
    <meta property="og:description" content="${d}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:locale" content="sv_SE" />
    <meta property="og:image" content="${img}" />
    <meta name="twitter:card" content="${cardType}" />
    <meta name="twitter:title" content="${t}" />
    <meta name="twitter:description" content="${d}" />
    <meta name="twitter:image" content="${img}" />
    <!-- Safety net: if a real browser reaches this page (e.g. a UA we didn't
         classify as a scraper), send it into the app. Scrapers ignore both. -->
    <meta http-equiv="refresh" content="0; url=${redirect}" />
  </head>
  <body>
    <p>Öppnar Badligan…</p>
    <script>
      location.replace(${shareScriptJson(appPath)});
    </script>
  </body>
</html>`;

    // Short cache: scrapers re-fetch and the underlying data changes rarely.
    res.set("Cache-Control", "public, max-age=300, s-maxage=600");
    res.set("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(html);
  },
);
