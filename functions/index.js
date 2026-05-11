import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";

initializeApp();

const PROJECT_REGION = "europe-west1";

// Throttle: how recent a stored reading has to be to be considered
// "fresh enough" — we won't re-fetch from the upstream API during this
// window. Independent of the client-side "is the reading stale?" check
// (which the UI does at 60 min).
const FRESH_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Per-user soft cap on refresh calls so a misbehaving client can't spin
// the upstream API for free.
const PER_USER_PER_HOUR = 60;

const DETAIL_URL = (nutsCode) =>
  `https://badplatsen.havochvatten.se/badplatsen/api/detail/${encodeURIComponent(nutsCode)}`;

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
    if (!place.externalId) {
      return { status: "no-data", reason: "no-external-id" };
    }
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

    // Fetch from Hav och Vatten.
    let reading = null;
    try {
      const res = await fetch(DETAIL_URL(place.externalId), {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
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
          typeof temp === "number" &&
          !Number.isNaN(temp) &&
          temp >= -5 &&
          temp <= 40 &&
          stamp &&
          !Number.isNaN(stamp)
        ) {
          reading = { temp, stamp };
        }
      }
    } catch (e) {
      logger.warn("upstream fetch failed", { placeId, error: String(e) });
    }

    if (!reading) {
      // Still record the attempt so we don't hammer immediately again.
      await placeRef.update({
        waterTempCheckedAt: FieldValue.serverTimestamp(),
      });
      return { status: "no-data" };
    }

    // Only write if it actually changed.
    if (
      place.waterTemp !== reading.temp ||
      place.waterTempAt !== reading.stamp
    ) {
      await placeRef.update({
        waterTemp: reading.temp,
        waterTempAt: reading.stamp,
      });
    }

    return {
      status: "updated",
      waterTemp: reading.temp,
      waterTempAt: reading.stamp,
    };
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

    const userRef = db.collection("users").doc(uid);
    const batch = db.batch();
    batch.update(groupRef, { members: FieldValue.arrayUnion(uid) });
    batch.update(userRef, { groups: FieldValue.arrayUnion(groupRef.id) });
    await batch.commit();

    return {
      id: groupRef.id,
      ...data,
      members: [...(data.members ?? []), uid],
    };
  },
);
