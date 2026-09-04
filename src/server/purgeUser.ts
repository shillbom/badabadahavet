// Shared by app/api/deleteAccount and app/api/banUser. Moved unchanged from
// functions/index.js.

import { getBucket, getDb, FieldValue } from "./firebaseAdmin";
import { removeFromTop } from "./leaderboard.js";

/**
 * Wipe every trace of a user's data: their sessions (and photos), their
 * group memberships (transferring ownership or deleting the group as
 * needed), and their user doc. Shared by the "delete my account" flow and
 * the admin ban route. Does not touch Firebase Auth — callers decide
 * whether to delete or disable the auth account afterwards.
 */
export async function purgeUserData(uid: string): Promise<void> {
  const db = getDb();

  // Sessions (+ collect photo paths for cleanup).
  const sessions = await db
    .collection("sessions")
    .where("uid", "==", uid)
    .get();
  const photoPaths: string[] = [];
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

  // Group memberships — mirror the leaveGroup route's 3-case handling per group.
  const groups = await db
    .collection("groups")
    .where("members", "array-contains", uid)
    .get();
  await Promise.all(
    groups.docs.map((g) => {
      const data = g.data();
      const remaining = (data.members ?? []).filter((m: string) => m !== uid);
      if (remaining.length === 0) return g.ref.delete();
      if (data.createdBy === uid) {
        return g.ref.update({ members: remaining, createdBy: remaining[0] });
      }
      return g.ref.update({ members: FieldValue.arrayRemove(uid) });
    }),
  );

  await db.collection("users").doc(uid).delete();

  // Drop the swimmer from any world-readable leaderboard snapshots. The
  // vacated slot is refilled by the per-year backfill job.
  const leaderboards = await db.collection("leaderboard").get();
  await Promise.all(
    leaderboards.docs.map((d) => {
      const top = d.data().top ?? [];
      if (!top.some((e: { uid?: string }) => e && e.uid === uid)) return null;
      return d.ref.set(
        { top: removeFromTop(top, uid), updatedAt: Date.now() },
        { merge: true },
      );
    }),
  );
  await Promise.all(
    photoPaths.map((p) =>
      getBucket()
        .file(p)
        .delete()
        .catch(() => {}),
    ),
  );
}
