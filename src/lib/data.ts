import {
  collection,
  doc,
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
  Unsubscribe,
} from "firebase/firestore";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";
import { db, storage } from "@/firebase";
import {
  GroupDoc,
  PlaceDoc,
  SessionDoc,
  UserDoc,
} from "./types";
import { generateGroupCode, haversineMeters } from "./utils";
import { PLACE_RADIUS_METERS, scoreSession } from "./scoring";

const usersCol = collection(db, "users");
const placesCol = collection(db, "places");
const sessionsCol = collection(db, "sessions");
const groupsCol = collection(db, "groups");

// ---------- Users ----------

export async function ensureUserDoc(
  uid: string,
  displayName: string,
): Promise<UserDoc> {
  const ref = doc(usersCol, uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data() as UserDoc;
  const data: UserDoc = {
    uid,
    displayName,
    emoji: pickEmoji(displayName),
    groups: [],
    createdAt: Date.now(),
  };
  await setDoc(ref, data);
  return data;
}

export async function updateUserDisplayName(uid: string, displayName: string) {
  await updateDoc(doc(usersCol, uid), { displayName });
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
  const { points, isWinter } = scoreSession({ isUniqueForUser, date: opts.date });

  let photoUrl: string | undefined;
  if (opts.photoFile) {
    const ext = opts.photoFile.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const r = storageRef(
      storage,
      `sessions/${opts.uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
    );
    await uploadBytes(r, opts.photoFile, {
      contentType: opts.photoFile.type || "image/jpeg",
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
    isUniqueForUser,
    isWinter,
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

export function watchAllSessions(
  cb: (sessions: SessionDoc[]) => void,
): Unsubscribe {
  return onSnapshot(sessionsCol, (snap) =>
    cb(snap.docs.map((d) => d.data() as SessionDoc)),
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
  const code = opts.code.trim().toUpperCase();
  const found = await getDocs(query(groupsCol, where("code", "==", code), limit(1)));
  if (found.empty) return null;
  const groupRef = found.docs[0].ref;
  const data = found.docs[0].data() as GroupDoc;
  if (!data.members.includes(opts.uid)) {
    await updateDoc(groupRef, { members: arrayUnion(opts.uid) });
    await updateDoc(doc(usersCol, opts.uid), { groups: arrayUnion(data.id) });
    data.members = [...data.members, opts.uid];
  }
  return data;
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
    query(sessionsCol, where("placeId", "==", placeId), orderBy("date", "desc")),
    (snap) => cb(snap.docs.map((d) => d.data() as SessionDoc)),
  );
}
