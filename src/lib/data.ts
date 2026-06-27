import {
  collection,
  doc,
  deleteDoc,
  deleteField,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  arrayRemove,
  arrayUnion,
  writeBatch,
  Unsubscribe,
} from "firebase/firestore";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { cloudFn, db, storage } from "@/firebase";
import { GroupDoc, PlaceDoc, SessionDoc, UserDoc } from "./types";
import { generateGroupCode, haversineMeters } from "./utils";
import { PLACE_RADIUS_METERS } from "./scoring";
import { compressImage, makeThumbDataUrl } from "./image";

const usersCol = collection(db, "users");
const placesCol = collection(db, "places");
const sessionsCol = collection(db, "sessions");
const groupsCol = collection(db, "groups");

// ---------- Users ----------

/**
 * Read the user doc, or create a minimal default if missing. Safe to
 * call from auth-state listeners — will never overwrite existing data.
 */
export async function ensureUserDoc(
  uid: string,
  fallbackDisplayName: string,
): Promise<UserDoc> {
  const ref = doc(usersCol, uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data() as UserDoc;
  const data: UserDoc = {
    uid,
    displayName: fallbackDisplayName,
    emoji: pickEmoji(fallbackDisplayName),
    createdAt: Date.now(),
  };
  await setDoc(ref, data);
  return data;
}

/**
 * Authoritative setup called only during signup — writes the full
 * profile in one shot so a racing auth listener can't clobber pieces
 * of it.
 */
export async function setupUserDoc(
  uid: string,
  displayName: string,
  opts: { locale: "sv" | "en"; homeCountry: string },
): Promise<UserDoc> {
  const ref = doc(usersCol, uid);
  const data: UserDoc = {
    uid,
    displayName,
    emoji: pickEmoji(displayName),
    locale: opts.locale,
    homeCountry: opts.homeCountry,
    createdAt: Date.now(),
  };
  await setDoc(ref, data, { merge: true });
  return data;
}

/**
 * Called after Google onboarding — updates an existing user doc without
 * touching `createdAt` (which the security rules forbid changing).
 */
export async function finalizeGoogleProfile(
  uid: string,
  displayName: string,
  opts: { locale: "sv" | "en"; homeCountry: string },
): Promise<void> {
  await updateDoc(doc(usersCol, uid), {
    displayName,
    emoji: pickEmoji(displayName),
    locale: opts.locale,
    homeCountry: opts.homeCountry,
  });
}

export async function updateUserLocale(uid: string, locale: "sv" | "en") {
  await updateDoc(doc(usersCol, uid), { locale });
}

export async function updateUserHomeCountry(uid: string, code: string) {
  await updateDoc(doc(usersCol, uid), { homeCountry: code });
}

export async function updateUserDisplayName(uid: string, displayName: string) {
  await updateDoc(doc(usersCol, uid), { displayName });
}

export async function updateUserEmoji(uid: string, emoji: string) {
  await updateDoc(doc(usersCol, uid), { emoji });
}

/** Set the user's chosen cosmetic border (pass "none" to clear it). */
export async function updateUserBorder(uid: string, borderId: string) {
  await updateDoc(doc(usersCol, uid), { selectedBorder: borderId });
}

export async function updateUserLastLocation(
  uid: string,
  lat: number,
  lng: number,
) {
  await updateDoc(doc(usersCol, uid), { lastLocation: { lat, lng } });
}

export async function recordAchievements(uid: string, ids: string[]) {
  if (ids.length === 0) return;
  const updates: Record<string, number> = {};
  const ts = Date.now();
  for (const id of ids) updates[`achievements.${id}`] = ts;
  await updateDoc(doc(usersCol, uid), updates);
}

// ---------- Toswim list ----------

/** Add a place to the user's "want to swim" list. No-op if already there. */
export async function addToSwim(uid: string, placeId: string): Promise<void> {
  await updateDoc(doc(usersCol, uid), {
    [`toswim.${placeId}`]: { addedAt: Date.now() },
  });
}

export async function removeFromSwim(
  uid: string,
  placeId: string,
): Promise<void> {
  await updateDoc(doc(usersCol, uid), {
    [`toswim.${placeId}`]: deleteField(),
  });
}

function pickEmoji(seed: string): string {
  const pool = ["🐬", "🦭", "🐟", "🦦", "🐳", "🪼", "🐠", "🦑", "🐢", "🦞"];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return pool[h % pool.length];
}

export async function fetchUsers(uids: string[]): Promise<UserDoc[]> {
  const out: UserDoc[] = [];
  await Promise.all(
    uids.map(async (uid) => {
      const s = await getDoc(doc(usersCol, uid));
      if (s.exists()) out.push(s.data() as UserDoc);
    }),
  );
  return out;
}

// ---------- Places ----------

export async function findOrCreatePlace(opts: {
  name: string;
  lat: number;
  lng: number;
  createdBy: string;
  date: number;
}): Promise<PlaceDoc> {
  // Match an existing place by exact name (case-insensitive) within radius.
  const all = await getDocs(placesCol);
  const target = { lat: opts.lat, lng: opts.lng };
  const nameKey = opts.name.trim().toLowerCase();
  let best: PlaceDoc | null = null;
  let bestDist = Infinity;
  all.forEach((d) => {
    const p = d.data() as PlaceDoc;
    const sameName = p.name.trim().toLowerCase() === nameKey;
    const dist = haversineMeters(target, { lat: p.lat, lng: p.lng });
    if (sameName && dist < PLACE_RADIUS_METERS && dist < bestDist) {
      best = p;
      bestDist = dist;
    }
  });
  if (best) return best;

  const ref = doc(placesCol);
  const data: PlaceDoc = {
    id: ref.id,
    name: opts.name.trim(),
    lat: opts.lat,
    lng: opts.lng,
    createdBy: opts.createdBy,
    firstSwumAt: opts.date,
    source: "manual",
    // No official feed for user-added spots — read temps from Open-Meteo.
    tempSource: "open-meteo",
  };
  await setDoc(ref, data);
  return data;
}

export function watchPlaces(cb: (places: PlaceDoc[]) => void): Unsubscribe {
  return onSnapshot(placesCol, (snap) => {
    cb(snap.docs.map((d) => d.data() as PlaceDoc));
  });
}

// ---------- Sessions ----------

export type LoggedSession = {
  id: string;
  points: number;
  isUniqueForUser: boolean;
  isWinter: boolean;
};

/**
 * Log a swim. The session doc and the user's score are written server-side
 * by the `logSession` Cloud Function (clients can't write either directly),
 * so scoring can't be forged. We only upload the photo here — the function
 * records its URL/path and computes points + uniqueness + winter.
 */
export async function createSession(opts: {
  uid: string;
  place: PlaceDoc;
  lat: number;
  lng: number;
  date: number;
  note?: string;
  photoFile?: File | null;
  /** Pre-resolved country (ISO alpha-2) — flags home vs. abroad swims. */
  country?: string | null;
  /** The swimmer's chosen border id — stamped onto the place for the map. */
  border?: string;
}): Promise<LoggedSession> {
  let photoUrl: string | undefined;
  let photoPath: string | undefined;
  let photoThumb: string | undefined;
  if (opts.photoFile) {
    // Compress first, then derive the tiny inline placeholder from the
    // already-downscaled file. Doing it sequentially (rather than decoding
    // the full-resolution original twice in parallel) keeps peak memory low
    // so large photos don't OOM the tab. `compressImage` throws an
    // ImageProcessingError for images too big to handle; we let that
    // propagate so the caller can show a specific message.
    const compressed = await compressImage(opts.photoFile);
    const thumb = await makeThumbDataUrl(compressed);
    photoThumb = thumb;
    const ext = compressed.name.split(".").pop()?.toLowerCase() ?? "jpg";
    photoPath = `sessions/${opts.uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const r = storageRef(storage, photoPath);
    await uploadBytes(r, compressed, {
      contentType: compressed.type || "image/jpeg",
    });
    photoUrl = await getDownloadURL(r);
  }

  const callable = cloudFn<
    {
      placeId: string;
      placeName: string;
      lat: number;
      lng: number;
      date: number;
      note?: string;
      country?: string;
      photoUrl?: string;
      photoPath?: string;
      photoThumb?: string;
      border?: string;
    },
    LoggedSession
  >("logSession");
  const res = await callable({
    placeId: opts.place.id,
    placeName: opts.place.name,
    lat: opts.lat,
    lng: opts.lng,
    date: opts.date,
    note: opts.note?.trim() || undefined,
    country: opts.country ?? undefined,
    photoUrl,
    photoPath,
    photoThumb,
    border: opts.border,
  });
  return res.data;
}

/**
 * Remove a swim via the `removeSession` Cloud Function, which deletes the
 * session, fixes the owner's score, and cleans up the photo. The owner may
 * remove their own; admins may remove anyone's.
 */
export async function removeSession(sessionId: string): Promise<void> {
  const callable = cloudFn<{ sessionId: string }, { ok: true }>(
    "removeSession",
  );
  await callable({ sessionId });
}

export function watchUserSessions(
  uid: string,
  cb: (sessions: SessionDoc[]) => void,
): Unsubscribe {
  return onSnapshot(
    query(sessionsCol, where("uid", "==", uid), orderBy("date", "desc")),
    (snap) => cb(snap.docs.map((d) => d.data() as SessionDoc)),
  );
}

/** Subscribe to all sessions for a fixed set of users (e.g. a group). */
export function watchMemberSessions(
  uids: string[],
  cb: (sessions: SessionDoc[]) => void,
): Unsubscribe {
  if (uids.length === 0) {
    cb([]);
    return () => {};
  }
  // Firestore `in` supports up to 30 values; chunk if needed.
  const chunks: string[][] = [];
  for (let i = 0; i < uids.length; i += 30) chunks.push(uids.slice(i, i + 30));

  const results = new Map<string, SessionDoc[]>();
  const unsubs = chunks.map((chunk, idx) =>
    onSnapshot(query(sessionsCol, where("uid", "in", chunk)), (snap) => {
      results.set(
        String(idx),
        snap.docs.map((d) => d.data() as SessionDoc),
      );
      cb([...results.values()].flat());
    }),
  );
  return () => unsubs.forEach((u) => u());
}

/**
 * Subscribe to every swim logged during a calendar year (defaults to the
 * current year). Personal history and per-place history are *not* time-
 * bounded — only "global" queries fan out across all users.
 */
export function watchAllSessions(
  cb: (sessions: SessionDoc[]) => void,
  year: number = new Date().getFullYear(),
): Unsubscribe {
  const start = new Date(year, 0, 1).getTime();
  const end = new Date(year + 1, 0, 1).getTime();
  return onSnapshot(
    query(sessionsCol, where("date", ">=", start), where("date", "<", end)),
    (snap) => cb(snap.docs.map((d) => d.data() as SessionDoc)),
  );
}

export const REACTION_EMOJIS = ["🔥", "💪", "❄️", "🤩", "👏"] as const;

/**
 * Toggle an emoji reaction on a session. If the user has already reacted
 * with this emoji, remove them; otherwise add them.
 */
export async function toggleReaction(
  sessionId: string,
  emoji: string,
  uid: string,
  currentReactors: string[],
): Promise<void> {
  const ref = doc(sessionsCol, sessionId);
  const field = `reactions.${emoji}`;
  if (currentReactors.includes(uid)) {
    await updateDoc(ref, { [field]: arrayRemove(uid) });
  } else {
    await updateDoc(ref, { [field]: arrayUnion(uid) });
  }
}

// ---------- Groups ----------

export async function createGroup(opts: {
  name: string;
  uid: string;
}): Promise<GroupDoc> {
  // Check uniqueness via the lookup Cloud Function (Admin SDK bypasses the
  // Firestore rules that prevent non-members from reading group docs).
  // Fails open after 5 attempts or if the function isn't reachable.
  let code = generateGroupCode();
  let codeFound = false;
  for (let i = 0; i < 5; i++) {
    const taken = await lookupGroupByCode(code);
    if (!taken) {
      codeFound = true;
      break;
    }
    code = generateGroupCode();
  }
  if (!codeFound) throw new Error("Could not generate a unique group code.");
  const ref = doc(groupsCol);
  const data: GroupDoc = {
    id: ref.id,
    name: opts.name.trim() || "Swim crew",
    code,
    members: [opts.uid],
    createdBy: opts.uid,
    createdAt: Date.now(),
  };
  await setDoc(ref, data);
  return data;
}

/** Preview a group without joining — returns name/emoji/memberCount or null. */
export async function lookupGroupByCode(code: string): Promise<{
  id: string;
  name: string;
  emoji: string | null;
  memberCount: number;
} | null> {
  const callable = cloudFn<
    { code: string },
    { id: string; name: string; emoji: string | null; memberCount: number }
  >("lookupGroupByCode");
  try {
    const res = await callable({ code });
    return res.data ?? null;
  } catch (err: unknown) {
    const errCode = (err as { code?: string })?.code;
    if (errCode === "functions/not-found") return null;
    throw err;
  }
}

export async function joinGroupByCode(opts: {
  code: string;
  uid: string;
}): Promise<GroupDoc | null> {
  // Group docs are not client-readable for non-members, so we go through
  // a Cloud Function (Admin SDK) which validates the code and atomically
  // adds the caller to the group.
  void opts.uid; // uid comes from auth context server-side; kept for callsite compat
  const callable = cloudFn<{ code: string }, GroupDoc>("joinGroupByCode");
  try {
    const res = await callable({ code: opts.code });
    return res.data ?? null;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === "functions/not-found") return null;
    throw err;
  }
}

export function watchUserGroups(
  uid: string,
  cb: (groups: GroupDoc[]) => void,
): Unsubscribe {
  return onSnapshot(
    query(groupsCol, where("members", "array-contains", uid)),
    (snap) => cb(snap.docs.map((d) => d.data() as GroupDoc)),
  );
}

export async function leaveGroup(opts: {
  groupId: string;
  uid: string;
}): Promise<void> {
  void opts.uid; // handled server-side from auth context
  const callable = cloudFn<{ groupId: string }, void>("leaveGroup");
  await callable({ groupId: opts.groupId });
}

/** Group creator updates name and/or emoji. */
export async function updateGroupMeta(
  groupId: string,
  opts: { name?: string; emoji?: string },
): Promise<void> {
  const updates: Record<string, string> = {};
  if (opts.name !== undefined) updates.name = opts.name.trim();
  if (opts.emoji !== undefined) updates.emoji = opts.emoji;
  if (Object.keys(updates).length)
    await updateDoc(doc(groupsCol, groupId), updates);
}

/** Group creator removes another member from the group. */
export async function kickGroupMember(opts: {
  groupId: string;
  memberUid: string;
}): Promise<void> {
  await updateDoc(doc(groupsCol, opts.groupId), {
    members: arrayRemove(opts.memberUid),
  });
}

// ---------- Spots / detail queries ----------

export async function getPlace(placeId: string) {
  const snap = await getDoc(doc(placesCol, placeId));
  return snap.exists() ? (snap.data() as PlaceDoc) : null;
}

export function watchPlaceSessions(
  placeId: string,
  cb: (sessions: SessionDoc[]) => void,
): Unsubscribe {
  return onSnapshot(
    query(
      sessionsCol,
      where("placeId", "==", placeId),
      orderBy("date", "desc"),
    ),
    (snap) => cb(snap.docs.map((d) => d.data() as SessionDoc)),
  );
}

// ---------- Account deletion ----------

/**
 * Tear down everything the caller owns: their sessions (and photos), their
 * group memberships, and the user doc itself. Runs server-side via the
 * `deleteAccount` Cloud Function — sessions can no longer be deleted by the
 * client (rules forbid it). Call before deleting the Firebase Auth user.
 */
export async function deleteAccountData(): Promise<void> {
  const callable = cloudFn<Record<string, never>, { ok: true }>(
    "deleteAccount",
  );
  await callable({});
}

// ---------- Admin / moderation ----------
//
// These are gated by the rules (`isAdminUser()` for Firestore, `isAdmin()`
// for Storage). The client also hides the UI behind `profile.isAdmin`, but
// the rules are the source of truth.

/** Rename a place and propagate the new label to every session. */
export async function adminRenamePlace(placeId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("empty name");
  await updateDoc(doc(placesCol, placeId), { name: trimmed });
  const snap = await getDocs(
    query(sessionsCol, where("placeId", "==", placeId)),
  );
  // Batches max 500 ops; we won't realistically hit that for one spot.
  const batch = writeBatch(db);
  snap.forEach((s) => batch.update(s.ref, { placeName: trimmed }));
  if (!snap.empty) await batch.commit();
}

/** Permanently strip the photo from a session and delete the storage object. */
export async function adminClearSessionPhoto(sessionId: string) {
  const snap = await getDoc(doc(sessionsCol, sessionId));
  if (!snap.exists()) return;
  const data = snap.data() as SessionDoc;
  if (data.photoPath) {
    try {
      await deleteObject(storageRef(storage, data.photoPath));
    } catch {
      // photo may already be gone — fall through and clear the fields.
    }
  }
  await updateDoc(doc(sessionsCol, sessionId), {
    photoUrl: deleteField(),
    photoPath: deleteField(),
  });
}

/**
 * Delete a single session. Routes through the removeSession Cloud Function
 * (Admin SDK) so the owner's score and the photo are cleaned up too.
 */
export async function adminDeleteSession(sessionId: string) {
  await removeSession(sessionId);
}

/** Delete a place and cascade-delete every session at it. */
export async function adminDeletePlace(placeId: string) {
  const sessions = await getDocs(
    query(sessionsCol, where("placeId", "==", placeId)),
  );
  // removeSession fixes each owner's score; do them sequentially to avoid
  // hammering the function with a burst.
  for (const s of sessions.docs) await removeSession(s.id);
  await deleteDoc(doc(placesCol, placeId));
}
