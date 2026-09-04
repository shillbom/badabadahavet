/**
 * POST /api/joinGroupByCode — join a group by its share code.
 *
 *   body: { code: string }
 *   returns: { id, name, emoji?, code, members: string[], createdBy, createdAt }
 *            404 `not-found` when there is no such group (the client maps
 *            that to `null`).
 *
 * Group docs are no longer client-readable unless you're already a
 * member, so the only way to look up a group by code is via this
 * route (which uses the Admin SDK and bypasses rules). Adds the
 * caller to `group.members` and to the user's `groups` array atomically.
 */

import { ApiError, readJson, requireUser, route } from "@/server/api";
import { FieldValue, getDb } from "@/server/firebaseAdmin";

export const runtime = "nodejs";

export const POST = route(async (req) => {
  const { uid } = await requireUser(req);
  const d = await readJson(req);
  const raw = d.code;
  if (typeof raw !== "string") {
    throw new ApiError("invalid-argument", "code is required.");
  }
  const code = raw.trim().toUpperCase();
  if (code.length < 3 || code.length > 12) {
    throw new ApiError("invalid-argument", "code looks invalid.");
  }

  const db = getDb();
  const matches = await db
    .collection("groups")
    .where("code", "==", code)
    .limit(1)
    .get();

  if (matches.empty) {
    throw new ApiError("not-found", "No group with that code.");
  }

  const groupRef = matches.docs[0]!.ref;
  const data = matches.docs[0]!.data();

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
});
