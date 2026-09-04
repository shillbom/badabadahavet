/**
 * POST /api/setPlaceInfo — add, edit, or clear (info = null) a place's
 * description, and/or flag the spot as a naturist (nude) bath.
 *
 *   body: { placeId: string, info?: string | null, nude?: boolean }
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

import { ApiError, logger, readJson, requireUser, route } from "@/server/api";
import { FieldValue, getDb } from "@/server/firebaseAdmin";
import { textAllowed } from "@/server/moderate";

export const runtime = "nodejs";

// Max length for a place's `info` text. Matches INFO_MAX_CHARS in
// scripts/update-temperatures.mjs — keep in sync.
const PLACE_INFO_MAX_CHARS = 1200;

// Minimum total points (summed across every year) before a user may
// contribute place info or toggle the naturist flag — keeps fresh
// throwaway accounts from editing spot pages. Matches MIN_INFO_POINTS
// in src/lib/data.ts — keep in sync.
const MIN_INFO_POINTS = 20;

export const POST = route(async (req) => {
  const { uid } = await requireUser(req);
  const d = await readJson(req);
  const placeId = d.placeId;
  if (typeof placeId !== "string" || !placeId) {
    throw new ApiError("invalid-argument", "placeId is required.");
  }
  const hasInfoField = d.info !== undefined;
  let info: string | null = null;
  if (hasInfoField && d.info !== null) {
    if (typeof d.info !== "string" || d.info.length > 4000) {
      throw new ApiError("invalid-argument", "info looks invalid.");
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
    throw new ApiError("invalid-argument", "nude looks invalid.");
  }
  const nude = typeof d.nude === "boolean" ? d.nude : null;
  if (!hasInfoField && nude === null) {
    throw new ApiError("invalid-argument", "Nothing to update.");
  }

  const db = getDb();
  const placeRef = db.collection("places").doc(placeId);
  const [placeSnap, userSnap] = await Promise.all([
    placeRef.get(),
    db.collection("users").doc(uid).get(),
  ]);
  if (!placeSnap.exists) {
    throw new ApiError("not-found", "Place doesn't exist.");
  }
  if (!userSnap.exists) {
    throw new ApiError("failed-precondition", "No profile yet.");
  }
  const place = placeSnap.data()!;
  const user = userSnap.data()!;
  const isAdmin = user.isAdmin === true;
  const totalPoints = Object.values(user.scores ?? {}).reduce(
    (sum: number, v: unknown) => sum + (typeof v === "number" ? v : 0),
    0,
  );
  if (!isAdmin && totalPoints < MIN_INFO_POINTS) {
    throw new ApiError(
      "permission-denied",
      "Not enough points to edit spot pages yet.",
    );
  }
  const ownsExisting = place.infoSource === "user" && place.infoBy === uid;
  if (hasInfoField && !isAdmin && place.info && !ownsExisting) {
    throw new ApiError("permission-denied", "This place already has info.");
  }

  const updates: Record<string, unknown> = {};
  // An unchanged text is a no-op (e.g. a nude-only toggle from the
  // editor) — don't re-attribute someone else's or official text.
  if (hasInfoField && info && info !== place.info) {
    if (!(await textAllowed(info))) {
      logger.info("setPlaceInfo rejected by moderation", { uid, placeId });
      throw new ApiError("invalid-argument", "Text rejected by moderation.", {
        reason: "moderation",
      });
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
    ok: true as const,
    info: hasInfoField ? info : (place.info ?? null),
    nude: nude ?? place.nude === true,
  };
});
