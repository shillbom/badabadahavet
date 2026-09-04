/**
 * POST /api/leaveGroup — leave a group.
 *
 *   body: { groupId: string }
 *   returns: null
 *
 * Three cases handled atomically:
 *   1. Last member leaves  → group is deleted.
 *   2. Founder leaves, others remain → ownership transferred to the first
 *      remaining member (sorted by join order in the members array).
 *   3. Regular member leaves → just removed from the members array.
 */

import { ApiError, readJson, requireUser, route } from "@/server/api";
import { FieldValue, getDb } from "@/server/firebaseAdmin";

export const runtime = "nodejs";

export const POST = route(async (req) => {
  const { uid } = await requireUser(req);
  const d = await readJson(req);
  const groupId = d.groupId;
  if (typeof groupId !== "string" || !groupId) {
    throw new ApiError("invalid-argument", "groupId is required.");
  }

  const db = getDb();
  const groupRef = db.collection("groups").doc(groupId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(groupRef);
    if (!snap.exists) {
      throw new ApiError("not-found", "Group not found.");
    }
    const data = snap.data()!;

    if (!Array.isArray(data.members) || !data.members.includes(uid)) {
      throw new ApiError("permission-denied", "Not a member of this group.");
    }

    const remaining = data.members.filter((m: string) => m !== uid);

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

  return null;
});
