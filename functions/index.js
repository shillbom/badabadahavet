import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import {
  swimYear,
  isWinterMonth,
  yearBounds,
  swimPoints,
  sumYearPoints,
} from "./scoring.js";

initializeApp();

const PROJECT_REGION = "europe-west1";

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

// SMHI's open oceanographic data — parameter 1 is sea water temperature
// from fixed coastal/buoy stations. There's no per-place station id, so we
// resolve the nearest active station to a place's coordinates on the fly.
const SMHI_STATIONS_URL =
  "https://opendata-download-ocobs.smhi.se/api/version/1.0/parameter/1.json";
const SMHI_DATA_URL = (stationId) =>
  `https://opendata-download-ocobs.smhi.se/api/version/1.0/parameter/1/station/${stationId}/period/latest-hour/data.json`;

// Don't match a place to a station further away than this — a spot with no
// nearby sensor should just get no SMHI reading rather than a bogus one.
const MAX_SMHI_STATION_DISTANCE_M = 40_000;

// The station list barely changes; cache it per-instance instead of
// re-fetching it on every single refresh call.
const SMHI_STATIONS_CACHE_MS = 6 * 60 * 60 * 1000;
let smhiStationsCache = null; // { at: number, stations: {id, lat, lng}[] }

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

async function fetchSmhiStations() {
  const now = Date.now();
  if (
    smhiStationsCache &&
    now - smhiStationsCache.at < SMHI_STATIONS_CACHE_MS
  ) {
    return smhiStationsCache.stations;
  }
  const res = await fetch(SMHI_STATIONS_URL, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return smhiStationsCache?.stations ?? [];
  const data = await res.json();
  const stations = (data?.station ?? [])
    .filter((s) => s.active !== false)
    .map((s) => ({ id: s.id, lat: s.latitude, lng: s.longitude }))
    .filter(
      (s) =>
        s.id != null && typeof s.lat === "number" && typeof s.lng === "number",
    );
  smhiStationsCache = { at: now, stations };
  return stations;
}

async function findNearestSmhiStation(lat, lng) {
  const stations = await fetchSmhiStations();
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
  const stationId = await findNearestSmhiStation(lat, lng);
  if (stationId == null) return null;
  const res = await fetch(SMHI_DATA_URL(stationId), {
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
 * Skips the upstream call entirely when the stored reading is < 15 min
 * old, returning "fresh". Tracks per-user invocations in
 * `refreshUsage/{uid}` so a runaway client maxes out at 60/hour.
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

    const placeRef = db.collection("places").doc(placeId);
    const placeSnap = await placeRef.get();
    if (!placeSnap.exists) {
      throw new HttpsError("not-found", "Place doesn't exist.");
    }
    const place = placeSnap.data();
    if (
      typeof place.waterTempAt === "number" &&
      now - place.waterTempAt < FRESH_WINDOW_MS
    ) {
      return {
        status: "fresh",
        waterTemp: place.waterTemp,
        waterTempAt: place.waterTempAt,
      };
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
      await placeRef.update({
        waterTempCheckedAt: FieldValue.serverTimestamp(),
      });
      return { status: "no-data" };
    }

    // Only write what actually changed.
    const updates = {};
    if (place.waterTemp !== reading.temp) updates.waterTemp = reading.temp;
    if (place.waterTempAt !== reading.stamp)
      updates.waterTempAt = reading.stamp;
    if (place.waterTempProvider !== reading.source) {
      // Which upstream actually produced this reading ("havochvatten",
      // "smhi", or "open-meteo") — distinct from `tempSource` (the
      // preference).
      updates.waterTempProvider = reading.source;
    }
    // Hav och Vatten had nothing (or nothing fresh) and SMHI actually
    // supplied the reading — prefer SMHI going forward instead of paying
    // for a Hav och Vatten call that keeps coming back empty.
    if (
      tempSource === "havochvatten" &&
      reading.source === "smhi" &&
      place.tempSource !== "smhi"
    ) {
      updates.tempSource = "smhi";
    }
    if (Object.keys(updates).length > 0) {
      await placeRef.update(updates);
    }

    return {
      status: "updated",
      waterTemp: reading.temp,
      waterTempAt: reading.stamp,
      provider: reading.source,
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

    const db = getFirestore();
    const userRef = db.collection("users").doc(uid);
    const sessionsCol = db.collection("sessions");
    const placeRef = db.collection("places").doc(placeId);
    const newRef = sessionsCol.doc();
    const year = swimYear(date);
    const [yStart, yEnd] = yearBounds(year);

    const result = await db.runTransaction(async (tx) => {
      // ── reads (all before any writes) ──
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        throw new HttpsError("failed-precondition", "No profile yet.");
      }
      const user = userSnap.data();
      const dupSnap = await tx.get(
        sessionsCol
          .where("uid", "==", uid)
          .where("placeId", "==", placeId)
          .limit(1),
      );
      const yearSnap = await tx.get(
        sessionsCol
          .where("uid", "==", uid)
          .where("date", ">=", yStart)
          .where("date", "<", yEnd)
          // orderBy matches the existing (uid, date DESC) composite index;
          // without it Firestore demands a separate (uid, date ASC) index.
          .orderBy("date", "desc"),
      );
      const placeSnap = await tx.get(placeRef);

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

      // ── writes ──
      tx.set(newRef, {
        ...session,
        createdAtServer: FieldValue.serverTimestamp(),
      });
      tx.update(userRef, { [`scores.${year}`]: yearTotal });

      // Stamp the place with this swim's frame when it's the most recent
      // swim there (so back-logged older swims don't override a newer one).
      const prevLast = placeSnap.exists ? placeSnap.data().lastSwimAt : null;
      if (
        placeSnap.exists &&
        (typeof prevLast !== "number" || date >= prevLast)
      ) {
        tx.update(placeRef, {
          lastSwimAt: date,
          lastSwimBy: uid,
          lastSwimBorder: border,
        });
      }

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

      // If this was the place's most recent swim, find the next-latest so we
      // can restamp the pin's outline. Only query when needed.
      const placeRef = db.collection("places").doc(session.placeId);
      const placeSnap = await tx.get(placeRef);
      const wasLastSwim =
        placeSnap.exists &&
        placeSnap.data().lastSwimAt === session.date &&
        placeSnap.data().lastSwimBy === ownerUid;
      let nextLast = null;
      if (wasLastSwim) {
        const placeSessions = await tx.get(
          db
            .collection("sessions")
            .where("placeId", "==", session.placeId)
            .orderBy("date", "desc"),
        );
        placeSessions.forEach((s) => {
          if (!nextLast && s.id !== sessionId) nextLast = s.data();
        });
      }

      // ── writes ──
      const yearTotal = sumYearPoints(yearSnap, sessionId);
      tx.delete(sessionRef);
      if (ownerSnap.exists) {
        tx.update(ownerRef, { [`scores.${year}`]: Math.max(0, yearTotal) });
      }
      if (wasLastSwim) {
        tx.update(
          placeRef,
          nextLast
            ? {
                lastSwimAt: nextLast.date,
                lastSwimBy: nextLast.uid,
                lastSwimBorder: nextLast.border ?? "none",
              }
            : {
                lastSwimAt: FieldValue.delete(),
                lastSwimBy: FieldValue.delete(),
                lastSwimBorder: FieldValue.delete(),
              },
        );
      }
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
    const uid = req.auth.uid;
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
    for (const g of groups.docs) {
      const data = g.data();
      const remaining = (data.members ?? []).filter((m) => m !== uid);
      if (remaining.length === 0) {
        await g.ref.delete();
      } else if (data.createdBy === uid) {
        await g.ref.update({ members: remaining, createdBy: remaining[0] });
      } else {
        await g.ref.update({ members: FieldValue.arrayRemove(uid) });
      }
    }

    await db.collection("users").doc(uid).delete();

    // Best-effort photo cleanup.
    await Promise.all(
      photoPaths.map((p) =>
        getStorage()
          .bucket()
          .file(p)
          .delete()
          .catch(() => {}),
      ),
    );

    return { ok: true };
  },
);
