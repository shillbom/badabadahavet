/**
 * POST /api/deleteAccount — delete the caller's account data. Removes all
 * their sessions (and photos), drops them from every group (transferring
 * ownership or deleting the group when needed), and deletes the user doc.
 * The client still calls Firebase Auth's deleteUser afterwards. Sessions
 * can't be deleted client-side (rules forbid it), so this runs server-side.
 *
 *   body: {} (ignored — the uid comes from the ID token)
 *   returns: { ok: true }
 */

import { requireUser, route } from "@/server/api";
import { purgeUserData } from "@/server/purgeUser";

export const runtime = "nodejs";

// The purge walks every session, group and leaderboard doc the user appears
// in; the callable allowed 120 s for it.
export const maxDuration = 120;

export const POST = route(async (req) => {
  const { uid } = await requireUser(req);
  await purgeUserData(uid);
  return { ok: true as const };
});
