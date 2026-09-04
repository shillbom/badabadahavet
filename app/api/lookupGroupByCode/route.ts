/**
 * POST /api/lookupGroupByCode — preview a group by its share code. No side
 * effects.
 *
 *   body: { code: string }
 *   returns: { id, name, emoji, memberCount }; 404 `not-found` when there is
 *            no such group (the client maps that to `null`).
 *
 * Used to show a "Do you want to join X?" confirmation before the user
 * commits. Group docs are not client-readable for non-members so we need
 * the Admin SDK here as well.
 */

import { ApiError, readJson, requireUser, route } from "@/server/api";
import { getDb } from "@/server/firebaseAdmin";

export const runtime = "nodejs";

export const POST = route(async (req) => {
  await requireUser(req);
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

  const data = matches.docs[0]!.data();
  return {
    id: matches.docs[0]!.id,
    name: data.name,
    emoji: data.emoji ?? null,
    memberCount: Array.isArray(data.members) ? data.members.length : 0,
  };
});
