/**
 * POST /api/banUser — admin only. Wipes a user's app data (sessions,
 * photos, group memberships, user doc) and bans them from Firebase Auth by
 * *disabling* the account — Firebase's mechanism for blocking sign-in.
 * (Deleting the auth account would let them immediately re-register.) An
 * audit record is written to `bannedUsers/{uid}` before the data is purged.
 *
 * Admins can't ban themselves or other admins.
 *
 *   body: { uid: string }
 *   returns: { ok: true }
 */

import { ApiError, logger, readJson, requireUser, route } from "@/server/api";
import { getAuth, getDb } from "@/server/firebaseAdmin";
import { purgeUserData } from "@/server/purgeUser";

export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = route(async (req) => {
  const { uid: callerUid } = await requireUser(req);
  const d = await readJson(req);
  const targetUid = d.uid;
  if (typeof targetUid !== "string" || !targetUid) {
    throw new ApiError("invalid-argument", "uid is required.");
  }
  if (targetUid === callerUid) {
    throw new ApiError("failed-precondition", "You can't ban yourself.");
  }

  const db = getDb();

  // Caller must be an admin. `isAdmin` lives on the user doc, not in the ID
  // token, and the Admin SDK bypasses rules — so check it here.
  const callerSnap = await db.collection("users").doc(callerUid).get();
  if (!callerSnap.exists || callerSnap.data()!.isAdmin !== true) {
    throw new ApiError("permission-denied", "Admins only.");
  }

  // Don't let admins ban each other.
  const targetSnap = await db.collection("users").doc(targetUid).get();
  if (targetSnap.exists && targetSnap.data()!.isAdmin === true) {
    throw new ApiError("failed-precondition", "You can't ban another admin.");
  }

  // Best-effort email lookup for the audit record before we disable.
  let email: string | null = null;
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
        ? (targetSnap.data()!.displayName ?? null)
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

  return { ok: true as const };
});
