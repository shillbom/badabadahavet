/**
 * POST /api/refreshPlaceTemp — refresh a single place's water temperature
 * on demand.
 *
 *   body: { placeId: string }
 *   returns: { status: "updated" | "fresh" | "no-data", waterTemp?,
 *              waterTempAt?, provider? }
 *
 * The reading is written to `placeTemps/{placeId}` — never to the place
 * doc, whose whole-collection listener would fan the write out to every
 * connected client. Only the open spot subscribes to placeTemps, so the
 * refresh reaches exactly the viewer who asked for it; everyone else keeps
 * the daily `tempSummary/current` reading. The `syncTempSummary` Firestore
 * trigger (still a Cloud Function — App Hosting has no triggers) folds the
 * new reading into the map's summary doc.
 *
 * Skips the upstream call entirely when the stored reading (or the last
 * fetch attempt, for spots whose feeds keep coming back empty) is < 15 min
 * old. Tracks per-user invocations in `refreshUsage/{uid}` so a runaway
 * client maxes out at 60/hour.
 */

import { ApiError, logger, readJson, requireUser, route } from "@/server/api";
import { getDb } from "@/server/firebaseAdmin";
import {
  fetchHavochvattenTemp,
  fetchOpenMeteoTemp,
  fetchSmhiTemp,
  type UpstreamReading,
} from "@/server/upstreamTemps";

export const runtime = "nodejs";

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

export const POST = route(async (req) => {
  const { uid } = await requireUser(req);
  const d = await readJson(req);
  const placeId = d.placeId;
  if (typeof placeId !== "string" || !placeId) {
    throw new ApiError("invalid-argument", "placeId is required.");
  }

  const db = getDb();

  // Per-user throttle.
  const usageRef = db.collection("refreshUsage").doc(uid);
  const usageSnap = await usageRef.get();
  const usage = usageSnap.exists ? usageSnap.data() : null;
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const recentCalls = (usage?.calls ?? []).filter((t: number) => t > hourAgo);
  if (recentCalls.length >= PER_USER_PER_HOUR) {
    throw new ApiError(
      "resource-exhausted",
      "Too many refresh requests — please wait a bit.",
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
    throw new ApiError("not-found", "Place doesn't exist.");
  }
  const place = placeSnap.data()!;
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
  let official: UpstreamReading | null = null;
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
  let reading: UpstreamReading | null =
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
  // (see src/server/tempLogic.js). The write to placeTemps is the single
  // source of truth; the syncTempSummary trigger folds it into the map's
  // tempSummary/current doc, so we never write the summary from here.
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
  // one remaining place-doc write: a once-ever flip of `tempSource`, a
  // preference, not reading churn. Deliberately does NOT stamp
  // `updatedAt` — no client reads `tempSource`, so advancing the delta
  // cursor would re-stream the doc to every signed-in client for nothing.
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
});
