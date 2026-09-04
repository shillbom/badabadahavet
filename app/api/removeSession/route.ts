/**
 * POST /api/removeSession — remove a swim. The owner may remove their own;
 * an admin may remove anyone's (moderation). Deletes the session, recomputes
 * the owner's per-year score, and removes the photo from Storage.
 *
 *   body: { sessionId: string }
 *   returns: { ok: true }
 */

import { ApiError, logger, readJson, requireUser, route } from "@/server/api";
import { getBucket, getDb } from "@/server/firebaseAdmin";
import {
  currentYear,
  sumYearPoints,
  swimYear,
  yearBounds,
  yearStats,
} from "@/server/scoring.js";
import { applyToTop, leaderboardEntry } from "@/server/leaderboard.js";

export const runtime = "nodejs";

export const POST = route(async (req) => {
  const { uid: callerUid } = await requireUser(req);
  const d = await readJson(req);
  const sessionId = d.sessionId;
  if (typeof sessionId !== "string" || !sessionId) {
    throw new ApiError("invalid-argument", "sessionId is required.");
  }

  const db = getDb();
  const sessionRef = db.collection("sessions").doc(sessionId);

  const photoPath = await db.runTransaction(async (tx) => {
    // ── reads ──
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists) {
      throw new ApiError("not-found", "Session not found.");
    }
    const session = sessionSnap.data()!;
    const ownerUid = session.uid;
    const isOwner = ownerUid === callerUid;

    let allowed = isOwner;
    if (!isOwner) {
      const callerSnap = await tx.get(db.collection("users").doc(callerUid));
      allowed = callerSnap.exists && callerSnap.data()!.isAdmin === true;
    }
    if (!allowed) {
      throw new ApiError(
        "permission-denied",
        "Not allowed to remove this session.",
      );
    }
    // The owner can't remove a swim from a past season (locked); an admin
    // still may, for moderation.
    if (isOwner && swimYear(session.date) < currentYear()) {
      throw new ApiError("failed-precondition", "Past seasons are locked.", {
        reason: "season-locked",
      });
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
            lbSnap.exists ? (lbSnap.data()!.top ?? []) : [],
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
    // placesSummary build, so removeSession never restamps the place doc.
    return (session.photoPath ?? null) as string | null;
  });

  // Best-effort photo cleanup, outside the transaction.
  if (photoPath) {
    try {
      await getBucket().file(photoPath).delete();
    } catch (e) {
      logger.warn("photo delete failed", { sessionId, error: String(e) });
    }
  }

  return { ok: true as const };
});
