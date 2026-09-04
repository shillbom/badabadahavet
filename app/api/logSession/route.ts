/**
 * POST /api/logSession — log a swim. This is the ONLY way a session is
 * created: Firestore rules forbid clients from writing the sessions
 * collection or the user's `scores` directly, so points can't be forged.
 * This handler writes with admin credentials, exactly like the `logSession`
 * callable it replaces.
 *
 *   body: { placeId, placeName, lat, lng, date, note?, country?,
 *           photoUrl?, photoPath?, photoThumb?, border?, waterTemp? }
 *   returns: { id, points, isUniqueForUser, isWinter, waterTemp,
 *              waterTempProvider }
 *
 * The photo (if any) is uploaded to Storage by the client first; we just
 * record its URL/path. Scoring + the per-year running total on the user
 * are updated atomically in a transaction. The year total is *recomputed*
 * from the user's sessions (not blindly incremented) so it self-heals even
 * if a previous write was lost.
 */

import { revalidatePath } from "next/cache";
import { ApiError, logger, readJson, requireUser, route } from "@/server/api";
import { FieldValue, getDb } from "@/server/firebaseAdmin";
import { localDay } from "@/server/dayKey";
import { textAllowed } from "@/server/moderate";
import {
  currentYearStart,
  isWinterMonth,
  latestLoggableMs,
  sumYearPoints,
  swimPoints,
  swimYear,
  yearBounds,
  yearStats,
} from "@/server/scoring.js";
import { applyToTop, leaderboardEntry } from "@/server/leaderboard.js";

// firebase-admin needs Node, not the Edge runtime.
export const runtime = "nodejs";

export const POST = route(async (req) => {
  const { uid } = await requireUser(req);
  const d = await readJson(req);

  const placeId = d.placeId;
  const placeName = d.placeName;
  const { lat, lng, date } = d as {
    lat?: unknown;
    lng?: unknown;
    date?: unknown;
  };
  if (typeof placeId !== "string" || !placeId) {
    throw new ApiError("invalid-argument", "placeId is required.");
  }
  if (
    typeof placeName !== "string" ||
    !placeName.trim() ||
    placeName.length > 80
  ) {
    throw new ApiError("invalid-argument", "placeName looks invalid.");
  }
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    throw new ApiError("invalid-argument", "Coordinates look invalid.");
  }
  if (
    typeof date !== "number" ||
    !Number.isFinite(date) ||
    date < currentYearStart() || // no logging into past seasons
    date > latestLoggableMs() // no logging into the future (with slack)
  ) {
    throw new ApiError("invalid-argument", "date looks invalid.", {
      reason: "date-range",
    });
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
      throw new ApiError("invalid-argument", "photoThumb looks invalid.");
    }
  }
  const photoThumb =
    typeof d.photoThumb === "string" && d.photoThumb.length <= 4000
      ? d.photoThumb
      : null;
  // The swimmer's chosen border at log time — denormalised onto the session
  // so the daily placesSummary build can outline each pin with the last
  // swimmer's frame without loading any sessions. "none" means no frame.
  const border =
    typeof d.border === "string" && d.border.length <= 20 ? d.border : "none";

  let waterTemp: number | null = null;
  let waterTempProvider: string | null = null;
  if (d.waterTemp !== undefined && d.waterTemp !== null) {
    const wt = Number(d.waterTemp);
    if (!Number.isNaN(wt) && wt >= -5 && wt <= 40) {
      waterTemp = Math.round(wt * 10) / 10;
      waterTempProvider = "user";
    }
  }

  // Authoritative moderation of user-supplied text (the client-side
  // pre-check in src/lib/moderation.ts is just UX and can be bypassed —
  // it now goes through /api/moderate, but it is still only UX).
  // textAllowed fails open on API errors/timeouts, so an outage never
  // blocks legitimate swims. Kept outside the transaction — network calls
  // don't belong in one.
  const [nameOk, noteOk] = await Promise.all([
    textAllowed(placeName),
    note ? textAllowed(note) : Promise.resolve(true),
  ]);
  if (!nameOk || !noteOk) {
    logger.info("logSession rejected by moderation", { uid });
    throw new ApiError("invalid-argument", "Text rejected by moderation.", {
      reason: "moderation",
    });
  }

  const db = getDb();
  const dateStr = localDay(date);

  // If the user didn't report a temp, check whether we have a stored temp
  // for that date; otherwise stay null.
  if (waterTemp === null) {
    try {
      const historySnap = await db
        .collection("placeTempHistory")
        .doc(placeId)
        .get();
      if (historySnap.exists) {
        const day = historySnap.data()?.days?.[dateStr];
        if (day && typeof day.t === "number") {
          waterTemp = day.t;
          waterTempProvider = day.p ?? "open-meteo";
        }
      }
      if (waterTemp === null) {
        const ptSnap = await db.collection("placeTemps").doc(placeId).get();
        if (ptSnap.exists) {
          const pt = ptSnap.data();
          if (typeof pt?.t === "number" && typeof pt?.at === "number") {
            const ptDateStr = localDay(pt.at);
            if (ptDateStr === dateStr) {
              waterTemp = pt.t;
              waterTempProvider = pt.p ?? "open-meteo";
            }
          }
        }
      }
    } catch (e) {
      logger.warn("stored temp lookup failed", {
        placeId,
        dateStr,
        error: String(e),
      });
    }
  }

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
      throw new ApiError("failed-precondition", "No profile yet.");
    }
    const user = userSnap.data()!;

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

    const session: Record<string, unknown> = {
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
    if (waterTemp !== null) {
      session.waterTemp = waterTemp;
      session.waterTempProvider = waterTempProvider;
    }

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
    // swimmer's fresh total (see src/server/leaderboard.js).
    tx.set(
      leaderboardRef,
      {
        year,
        top: applyToTop(
          lbSnap.exists ? (lbSnap.data()!.top ?? []) : [],
          leaderboardEntry(uid, user, yearTotal, stats),
        ),
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    // The place's "last swim" frame is NOT denormalised here — the daily
    // placesSummary build derives it from sessions. logSession never touches
    // the place doc, so a swim never re-streams it to every client on the
    // `places`/summary listeners. Keep it that way.

    return {
      id: newRef.id,
      points,
      isUniqueForUser,
      isWinter,
      waterTemp,
      waterTempProvider,
    };
  });

  if (waterTemp !== null) {
    try {
      await db
        .collection("placeTempHistory")
        .doc(placeId)
        .set(
          {
            placeId,
            days: {
              [dateStr]: { t: waterTemp, p: waterTempProvider },
            },
            updatedAt: Date.now(),
          },
          { merge: true },
        );
    } catch (e) {
      logger.warn("failed updating placeTempHistory", {
        placeId,
        error: String(e),
      });
    }
  }

  if (waterTempProvider === "user" && waterTemp !== null) {
    // placeTemps only — never reading fields on the place doc. The
    // syncTempSummary Firestore trigger (still a Cloud Function) folds this
    // into tempSummary/current for the map.
    try {
      await db.collection("placeTemps").doc(placeId).set(
        {
          placeId,
          t: waterTemp,
          at: date,
          p: "user",
          checkedAt: Date.now(),
        },
        { merge: true },
      );
    } catch (e) {
      logger.warn("failed updating placeTemps with user temp", {
        placeId,
        error: String(e),
      });
    }
  }

  // The spot page is a cached server render (see
  // app/(app)/spot/[placeId]/page.tsx) holding this place's swim count, photo
  // strip and recent-dips list. Drop that cache so the new swim is on the
  // page — and in its share card — immediately instead of after `revalidate`.
  revalidatePath(`/spot/${placeId}`);

  return result;
});
