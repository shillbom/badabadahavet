/**
 * POST /api/updateSession — edit a swim. Owner only; the editable fields are
 * the date, the note, the photo and the water temp (place and coordinates are
 * fixed — log a new swim for a different spot). Recomputes what depends on the
 * date — isWinter, points, and the owner's per-year score/stats (both years
 * when the edit crosses a year boundary) — inside a transaction, the same
 * self-healing recompute as logSession/removeSession. A replaced/removed
 * photo's storage object is cleaned up best-effort afterwards.
 *
 *   body: { sessionId: string,
 *           date?: number,                       // omit = keep
 *           note?: string | null,                // omit = keep, null = clear
 *           photo?: { url, path, thumb? } | null // omit = keep, null = remove
 *           waterTemp?: number | null            // omit = keep, null = clear
 *         }
 *   returns: { ok: true, points: number, isWinter: boolean }
 */

import { ApiError, logger, readJson, requireUser, route } from "@/server/api";
import { FieldValue, getBucket, getDb } from "@/server/firebaseAdmin";
import { localDay } from "@/server/dayKey";
import { textAllowed } from "@/server/moderate";
import {
  currentYear,
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

export const runtime = "nodejs";

export const POST = route(async (req) => {
  const { uid: callerUid } = await requireUser(req);
  const d = await readJson(req);
  const sessionId = d.sessionId;
  if (typeof sessionId !== "string" || !sessionId) {
    throw new ApiError("invalid-argument", "sessionId is required.");
  }

  // date: omitted = keep. Same bounds as logSession.
  let newDate: number | null = null;
  if (d.date !== undefined) {
    if (
      typeof d.date !== "number" ||
      !Number.isFinite(d.date) ||
      d.date < currentYearStart() || // can't move a swim into a past season
      d.date > latestLoggableMs() // ...or the future (with slack)
    ) {
      throw new ApiError("invalid-argument", "date looks invalid.", {
        reason: "date-range",
      });
    }
    newDate = d.date;
  }

  // note: omitted = keep, null (or blank) = clear, string = replace.
  const hasNote = d.note !== undefined;
  let note: string | null = null;
  if (hasNote && d.note !== null) {
    if (typeof d.note !== "string" || d.note.length > 2000) {
      throw new ApiError("invalid-argument", "note looks invalid.");
    }
    note = d.note.trim().slice(0, 500) || null;
  }

  // photo: omitted = keep, null = remove, { url, path, thumb? } = replace
  // (the client uploads the new object to Storage first, like logSession).
  const hasPhoto = d.photo !== undefined;
  let photo: { url: string; path: string; thumb: string | null } | null = null;
  if (hasPhoto && d.photo !== null) {
    const p = d.photo as {
      url?: unknown;
      path?: unknown;
      thumb?: unknown;
    } | null;
    if (
      typeof p !== "object" ||
      p === null ||
      typeof p.url !== "string" ||
      !p.url ||
      typeof p.path !== "string" ||
      !p.path
    ) {
      throw new ApiError("invalid-argument", "photo looks invalid.");
    }
    if (
      p.thumb !== undefined &&
      p.thumb !== null &&
      (typeof p.thumb !== "string" || p.thumb.length > 4000)
    ) {
      throw new ApiError("invalid-argument", "photoThumb looks invalid.");
    }
    photo = {
      url: p.url,
      path: p.path,
      thumb: typeof p.thumb === "string" ? p.thumb : null,
    };
  }

  const hasWaterTemp = d.waterTemp !== undefined;
  let waterTemp: number | null = null;
  if (hasWaterTemp && d.waterTemp !== null) {
    const wt = Number(d.waterTemp);
    if (!Number.isNaN(wt) && wt >= -5 && wt <= 40) {
      waterTemp = Math.round(wt * 10) / 10;
    }
  }

  if (newDate === null && !hasNote && !hasPhoto && !hasWaterTemp) {
    throw new ApiError("invalid-argument", "Nothing to update.");
  }

  // Authoritative moderation of a changed note — same as logSession
  // (fails open on outages, outside the transaction).
  if (note && !(await textAllowed(note))) {
    logger.info("updateSession rejected by moderation", { uid: callerUid });
    throw new ApiError("invalid-argument", "Text rejected by moderation.", {
      reason: "moderation",
    });
  }

  const db = getDb();
  const sessionRef = db.collection("sessions").doc(sessionId);
  const userRef = db.collection("users").doc(callerUid);
  const yearQuery = (year: number) => {
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
      throw new ApiError("not-found", "Session not found.");
    }
    const session = sessionSnap.data()!;
    if (session.uid !== callerUid) {
      throw new ApiError(
        "permission-denied",
        "Not allowed to edit this session.",
      );
    }
    // Past seasons are locked — a swim from a previous year can't be edited.
    if (swimYear(session.date) < currentYear()) {
      throw new ApiError("failed-precondition", "Past seasons are locked.", {
        reason: "season-locked",
      });
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
    const updatedSession: Record<string, unknown> = {
      ...session,
      date,
      isWinter,
      points,
    };
    if (hasNote) {
      if (note) updatedSession.note = note;
      else delete updatedSession.note;
    }

    const updates: Record<string, unknown> = { date, isWinter, points };
    if (hasNote) {
      updates.note = note ?? FieldValue.delete();
    }
    if (hasWaterTemp) {
      if (waterTemp !== null) {
        updates.waterTemp = waterTemp;
        updates.waterTempProvider = "user";
        updatedSession.waterTemp = waterTemp;
        updatedSession.waterTempProvider = "user";
      } else {
        updates.waterTemp = FieldValue.delete();
        updates.waterTempProvider = FieldValue.delete();
        delete updatedSession.waterTemp;
        delete updatedSession.waterTempProvider;
      }
    }
    let removedPhotoPath: string | null = null;
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
      const newScore = Math.max(0, sumYearPoints(yearSnap, sessionId) + points);
      const newStats = yearStats(yearSnap, {
        excludeId: sessionId,
        extra: updatedSession,
      });
      const userUpdates: Record<string, unknown> = {
        [`scores.${year}`]: newScore,
        [`statsByYear.${year}`]: newStats,
      };
      // Keep the world-readable top-5 snapshot in sync for the edited year.
      tx.set(
        leaderboardRef,
        {
          year,
          top: applyToTop(
            lbSnap.exists ? (lbSnap.data()!.top ?? []) : [],
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
                oldLbSnap?.exists ? (oldLbSnap.data()!.top ?? []) : [],
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
      await getBucket().file(result.removedPhotoPath).delete();
    } catch (e) {
      logger.warn("photo delete failed", { sessionId, error: String(e) });
    }
  }

  if (hasWaterTemp && waterTemp !== null) {
    try {
      const sessionSnap = await db.collection("sessions").doc(sessionId).get();
      if (sessionSnap.exists) {
        const placeId = sessionSnap.data()?.placeId;
        const sDate = sessionSnap.data()?.date ?? Date.now();
        const dateStr = localDay(sDate);
        if (placeId) {
          await db
            .collection("placeTempHistory")
            .doc(placeId)
            .set(
              {
                placeId,
                days: {
                  [dateStr]: { t: waterTemp, p: "user" },
                },
                updatedAt: Date.now(),
              },
              { merge: true },
            );
          // placeTemps only — the place doc never carries reading fields.
          await db.collection("placeTemps").doc(placeId).set(
            {
              placeId,
              t: waterTemp,
              at: sDate,
              p: "user",
              checkedAt: Date.now(),
            },
            { merge: true },
          );
        }
      }
    } catch (e) {
      logger.warn("failed updating place temps after session edit", {
        sessionId,
        error: String(e),
      });
    }
  }

  return {
    ok: true as const,
    points: result.points,
    isWinter: result.isWinter,
  };
});
