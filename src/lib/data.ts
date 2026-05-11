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
  serverTimestamp,
  arrayRemove,
  arrayUnion,
  limit,
  writeBatch,
  Unsubscribe,
} from "firebase/firestore";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { db, functions, storage } from "@/firebase";
import { httpsCallable } from "firebase/functions";
import { GroupDoc, PlaceDoc, SessionDoc, UserDoc } from "./types";
import { generateGroupCode, haversineMeters } from "./utils";
import { PLACE_RADIUS_METERS, scoreSession } from "./scoring";
import { compressImage } from "./image";

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
    groups: [],
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
    groups: [],
    locale: opts.locale,
    homeCountry: opts.homeCountry,
    createdAt: Date.now(),
  };
  await setDoc(ref, data, { merge: true });
  return data;
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

export async function createSession(opts: {
  uid: string;
  displayName: string;
  place: PlaceDoc;
  lat: number;
  lng: number;
  date: number;
  note?: string;
  photoFile?: File | null;
  /** Pre-resolved country (ISO alpha-2) — passed in so scoring can use it. */
  country?: string | null;
  /** Home country of the swimmer, used for bracket scoring. */
  homeCountry?: string | null;
}): Promise<SessionDoc> {
  // Has this user swum at this place before?
  const prev = await getDocs(
    query(
      sessionsCol,
      where("uid", "==", opts.uid),
      where("placeId", "==", opts.place.id),
      limit(1),
    ),
  );
  const isUniqueForUser = prev.empty;
  const { points, isWinter, isHomeCountry, monthCategory } = scoreSession({
    isUniqueForUser,
    date: opts.date,
    country: opts.country ?? null,
    homeCountry: opts.homeCountry ?? null,
  });

  let photoUrl: string | undefined;
  let photoPath: string | undefined;
  if (opts.photoFile) {
    const compressed = await compressImage(opts.photoFile);
    const ext = compressed.name.split(".").pop()?.toLowerCase() ?? "jpg";
    photoPath = `sessions/${opts.uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const r = storageRef(storage, photoPath);
    await uploadBytes(r, compressed, {
      contentType: compressed.type || "image/jpeg",
    });
    photoUrl = await getDownloadURL(r);
  }

  const ref = doc(sessionsCol);
  const data: SessionDoc = {
    id: ref.id,
    uid: opts.uid,
    displayName: opts.displayName,
    placeId: opts.place.id,
    placeName: opts.place.name,
    lat: opts.lat,
    lng: opts.lng,
    date: opts.date,
    note: opts.note?.trim() || undefined,
    photoUrl,
    photoPath,
    isUniqueForUser,
    isWinter,
    isHomeCountry,
    country: opts.country ?? undefined,
    monthCategory,
    points,
    createdAt: Date.now(),
  };
  // strip undefineds for Firestore
  const clean = JSON.parse(JSON.stringify(data));
  await setDoc(ref, { ...clean, createdAtServer: serverTimestamp() });
  return data;
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

// ---------- Groups ----------

export async function createGroup(opts: {
  name: string;
  uid: string;
}): Promise<GroupDoc> {
  let code = generateGroupCode();
  for (let i = 0; i < 5; i++) {
    const existing = await getDocs(query(groupsCol, where("code", "==", code)));
    if (existing.empty) break;
    code = generateGroupCode();
  }
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
  await updateDoc(doc(usersCol, opts.uid), { groups: arrayUnion(ref.id) });
  return data;
}

export async function joinGroupByCode(opts: {
  code: string;
  uid: string;
}): Promise<GroupDoc | null> {
  // Group docs are not client-readable for non-members, so we go through
  // a Cloud Function (Admin SDK) which validates the code and atomically
  // adds the caller to the group.
  void opts.uid; // uid comes from auth context server-side; kept for callsite compat
  const callable = httpsCallable<{ code: string }, GroupDoc>(
    functions,
    "joinGroupByCode",
  );
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
  await updateDoc(doc(groupsCol, opts.groupId), {
    members: arrayRemove(opts.uid),
  });
  await updateDoc(doc(usersCol, opts.uid), {
    groups: arrayRemove(opts.groupId),
  });
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
  await updateDoc(doc(usersCol, opts.memberUid), {
    groups: arrayRemove(opts.groupId),
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
 * Tear down everything a user owns: their sessions (and photos), their
 * group memberships, and the user doc itself. Call before deleting the
 * Firebase Auth user — once the auth user is gone the client can't
 * authenticate the deletes.
 */
export async function deleteAccountData(uid: string): Promise<void> {
  // Sessions (with their storage photos) — only the owner's docs.
  const sessions = await getDocs(query(sessionsCol, where("uid", "==", uid)));
  await Promise.all(
    sessions.docs.map(async (s) => {
      const data = s.data() as SessionDoc;
      if (data.photoPath) {
        try {
          await deleteObject(storageRef(storage, data.photoPath));
        } catch {
          // photo may already be gone — ignore.
        }
      }
      await deleteDoc(s.ref);
    }),
  );

  // Drop the user from every group they're a member of.
  const memberOf = await getDocs(
    query(groupsCol, where("members", "array-contains", uid)),
  );
  await Promise.all(
    memberOf.docs.map((g) => updateDoc(g.ref, { members: arrayRemove(uid) })),
  );

  await deleteDoc(doc(usersCol, uid));
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

/** Delete a single session and its photo, if any. */
export async function adminDeleteSession(sessionId: string) {
  const snap = await getDoc(doc(sessionsCol, sessionId));
  if (snap.exists()) {
    const data = snap.data() as SessionDoc;
    if (data.photoPath) {
      try {
        await deleteObject(storageRef(storage, data.photoPath));
      } catch {
        // ignore
      }
    }
  }
  await deleteDoc(doc(sessionsCol, sessionId));
}

/** Delete a place and cascade-delete every session at it. */
export async function adminDeletePlace(placeId: string) {
  const sessions = await getDocs(
    query(sessionsCol, where("placeId", "==", placeId)),
  );
  await Promise.all(sessions.docs.map((s) => adminDeleteSession(s.id)));
  await deleteDoc(doc(placesCol, placeId));
}
