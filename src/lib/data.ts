import {
  collection,
  doc,
  deleteDoc,
  deleteField,
  documentId,
  getDoc,
  getDocs,
  limit,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  arrayRemove,
  writeBatch,
} from "firebase/firestore";
import type { Unsubscribe } from "firebase/firestore";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { cloudFn, db, storage } from "@/firebase";
import type {
  GroupDoc,
  PlaceDoc,
  PlacePin,
  PlaceSummaryEntry,
  PlacesSummaryDoc,
  PlaceTempDoc,
  PlaceTempHistoryDoc,
  SessionDoc,
  TempReading,
  TempSummaryDoc,
  UserDoc,
  BannedUser,
  LeaderboardEntry,
  WaterSample,
} from "./types";
import { summaryToMap, qualityToMap } from "./temps";
import { summaryToPlaces } from "./places";
import { generateGroupCode, haversineMeters } from "./utils";
import { PLACE_RADIUS_METERS } from "./scoring";
import { compressImage, makeThumbDataUrl } from "./image";
import { assertTextAllowed, ModerationError } from "./moderation";

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

/**
 * Stamp the user's "last seen" timestamp to `ts` (call once per app boot).
 * The value that was stored *before* this write is what drives the
 * "while you were away" digest, so callers must read the old value first.
 * Best-effort: a failed write just means no digest next time, so we never
 * let it surface as an error.
 */
export async function touchLastSeen(uid: string, ts: number): Promise<void> {
  try {
    await updateDoc(doc(usersCol, uid), { lastSeenAt: ts });
  } catch {
    /* offline / transient — ignore, it's a non-critical convenience field */
  }
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

/** The leaderboard shows at most this many users — keeps the roster
 *  subscription from streaming every user doc as the app grows. */
export const LEADERBOARD_LIMIT = 100;

/**
 * Live leaderboard roster: users ordered by their server-maintained
 * score for `year`, highest first (top LEADERBOARD_LIMIT). Users with no
 * score that year are absent from the query result — which is exactly
 * "not on the board".
 */
export function watchUsersByYearScore(
  year: number,
  cb: (users: UserDoc[]) => void,
): Unsubscribe {
  return onSnapshot(
    query(
      usersCol,
      orderBy(`scores.${year}`, "desc"),
      limit(LEADERBOARD_LIMIT),
    ),
    (snap) => cb(snap.docs.map((d) => d.data() as UserDoc)),
  );
}

/**
 * Live global top-5 leaderboard snapshot for `year` (`leaderboard/{year}`).
 * World-readable, so signed-out guests get the global board without access
 * to individual user docs. Maintained server-side by the scoring functions
 * and rebuilt by scripts/backfill-toplist.mjs.
 */
export function watchGlobalLeaderboard(
  year: number,
  cb: (entries: LeaderboardEntry[]) => void,
): Unsubscribe {
  return onSnapshot(doc(db, "leaderboard", String(year)), (snap) => {
    const data = snap.exists()
      ? (snap.data() as { top?: LeaderboardEntry[] })
      : null;
    cb(Array.isArray(data?.top) ? (data.top as LeaderboardEntry[]) : []);
  });
}

export async function fetchUsers(uids: string[]): Promise<UserDoc[]> {
  if (uids.length === 0) return [];
  // Firestore `in` supports up to 30 values; chunk if needed. One query per
  // chunk instead of one getDoc round-trip per uid.
  const chunks: string[][] = [];
  for (let i = 0; i < uids.length; i += 30) chunks.push(uids.slice(i, i + 30));
  const out: UserDoc[] = [];
  await Promise.all(
    chunks.map(async (chunk) => {
      const snap = await getDocs(
        query(usersCol, where(documentId(), "in", chunk)),
      );
      snap.forEach((d) => out.push(d.data() as UserDoc));
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
  /** Current known places — the store's live `places` array. Matching runs
   *  against this instead of re-downloading the whole collection per log. */
  existingPlaces: PlacePin[];
}): Promise<PlacePin> {
  // Match an existing place by exact name (case-insensitive) within radius.
  const target = { lat: opts.lat, lng: opts.lng };
  const nameKey = opts.name.trim().toLowerCase();
  let best: PlacePin | null = null;
  let bestDist = Infinity;
  for (const p of opts.existingPlaces) {
    const sameName = p.name.trim().toLowerCase() === nameKey;
    const dist = haversineMeters(target, { lat: p.lat, lng: p.lng });
    if (sameName && dist < PLACE_RADIUS_METERS && dist < bestDist) {
      best = p;
      bestDist = dist;
    }
  }
  if (best) return best;

  // Only brand-new names get the moderation pre-check — matching an
  // existing place must never be blocked by a false positive on a name
  // that's already on the map.
  await assertTextAllowed(opts.name);

  const ref = doc(placesCol);
  const data: PlaceDoc = {
    id: ref.id,
    name: opts.name.trim(),
    lat: opts.lat,
    lng: opts.lng,
    createdBy: opts.createdBy,
    firstSwumAt: opts.date,
    // Wall-clock cursor for the placesSummary delta listener — distinct from
    // firstSwumAt, which is the (back-datable) swim date. Lets a brand-new
    // spot surface on every client before the next nightly summary build.
    updatedAt: Date.now(),
    source: "manual",
    // No official feed for user-added spots — read temps from Open-Meteo.
    tempSource: "open-meteo",
  };
  await setDoc(ref, data);
  return data;
}

/**
 * The lightweight map fields for every place, packed into the single
 * `placesSummary/current` doc by the daily sweep. One doc read replaces the
 * always-on whole-collection (~4k-doc) `places` listener; recent changes come
 * from the bounded `watchPlaceChangesSince` delta. `exists` is false until the
 * first daily build has produced the doc — the store falls back to a one-time
 * full read then (see `getAllPlacesOnce`) so the map is never blank.
 */
export function watchPlacesSummary(
  cb: (data: { pins: PlacePin[]; builtAt: number; exists: boolean }) => void,
): Unsubscribe {
  return onSnapshot(doc(db, "placesSummary", "current"), (snap) => {
    const data = snap.exists() ? (snap.data() as PlacesSummaryDoc) : null;
    // `packed` is JSON.stringify(entries) in a single field (see PlacesSummaryDoc)
    // — the doc is ~7x smaller on the wire than the raw entries map. Fall back to
    // a legacy `entries` map so a new client still reads a not-yet-repacked doc.
    let entries: Record<string, PlaceSummaryEntry> | undefined;
    if (data && typeof data.packed === "string") {
      try {
        entries = JSON.parse(data.packed) as Record<string, PlaceSummaryEntry>;
      } catch {
        entries = undefined;
      }
    } else {
      entries = data?.entries;
    }
    cb({
      pins: summaryToPlaces(entries),
      builtAt: typeof data?.builtAt === "number" ? data.builtAt : 0,
      exists: snap.exists(),
    });
  });
}

/**
 * Places created or edited since the summary was built (`updatedAt > builtAt`)
 * — a handful of docs a day, not the whole collection. The store overlays
 * these full docs onto the summary pins so brand-new spots and same-day
 * renames/info edits appear without waiting for the next nightly build.
 * `updatedAt` is a single-field inequality, so Firestore's automatic
 * single-field index covers it (no composite needed).
 */
export function watchPlaceChangesSince(
  builtAt: number,
  cb: (docs: PlaceDoc[]) => void,
): Unsubscribe {
  return onSnapshot(
    query(placesCol, where("updatedAt", ">", builtAt)),
    (snap) => cb(snap.docs.map((d) => d.data() as PlaceDoc)),
  );
}

/** One-time full read of the `places` collection — the degraded fallback the
 *  store uses only when `placesSummary/current` is missing (e.g. before the
 *  first daily build), so an early client sees pins instead of a blank map. */
export async function getAllPlacesOnce(): Promise<PlaceDoc[]> {
  const snap = await getDocs(placesCol);
  return snap.docs.map((d) => d.data() as PlaceDoc);
}

/**
 * Every place's latest water temperature and water-quality sample, packed
 * into the single `tempSummary/current` doc by the daily sweep. One always-on
 * listener on one doc (~1 read/client/day) replaces receiving each write as a
 * per-place delta on the whole-collection `places` listener.
 */
export function watchTempSummary(
  cb: (data: {
    temps: Map<string, TempReading>;
    quality: Map<string, WaterSample>;
  }) => void,
): Unsubscribe {
  return onSnapshot(doc(db, "tempSummary", "current"), (snap) => {
    const data = snap.exists() ? (snap.data() as TempSummaryDoc) : null;
    cb({
      temps: summaryToMap(data?.entries),
      quality: qualityToMap(data?.quality),
    });
  });
}

/**
 * The live per-place reading (`placeTemps/{placeId}`) — fresher than the
 * daily summary when an on-demand refreshPlaceTemp call has landed. Only
 * subscribe to this for the currently open spot.
 */
export function watchPlaceTemp(
  placeId: string,
  cb: (temp: PlaceTempDoc | null) => void,
): Unsubscribe {
  return onSnapshot(doc(db, "placeTemps", placeId), (snap) =>
    cb(snap.exists() ? (snap.data() as PlaceTempDoc) : null),
  );
}

/**
 * Daily temperature history recorded for a spot (`placeTempHistory/{placeId}`).
 */
export function watchPlaceTempHistory(
  placeId: string,
  cb: (history: PlaceTempHistoryDoc | null) => void,
): Unsubscribe {
  return onSnapshot(doc(db, "placeTempHistory", placeId), (snap) =>
    cb(snap.exists() ? (snap.data() as PlaceTempHistoryDoc) : null),
  );
}

// ---------- Sessions ----------

export type LoggedSession = {
  id: string;
  points: number;
  isUniqueForUser: boolean;
  isWinter: boolean;
};

type UploadedPhoto = { url: string; path: string; thumb: string | undefined };

/**
 * Compress and upload a swim photo to Storage, returning the pieces the
 * session functions store (download URL, storage path, inline LQIP thumb).
 * Shared by createSession and updateSession.
 */
async function uploadSessionPhoto(
  uid: string,
  file: File,
): Promise<UploadedPhoto> {
  // Compress first, then derive the tiny inline placeholder from the
  // already-downscaled file. Doing it sequentially (rather than decoding
  // the full-resolution original twice in parallel) keeps peak memory low
  // so large photos don't OOM the tab. `compressImage` throws an
  // ImageProcessingError for images too big to handle; we let that
  // propagate so the caller can show a specific message.
  const compressed = await compressImage(file);
  const thumb = await makeThumbDataUrl(compressed);
  const ext = compressed.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const path = `sessions/${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const r = storageRef(storage, path);
  await uploadBytes(r, compressed, {
    contentType: compressed.type || "image/jpeg",
    // The path is unique per upload and the object is never rewritten, so
    // browsers/CDNs may cache the download URL forever — saves re-fetching
    // photos that the service-worker cache has evicted.
    cacheControl: "public, max-age=31536000, immutable",
  });
  const url = await getDownloadURL(r);
  return { url, path, thumb };
}

/** Surface the functions' moderation rejection as a ModerationError so
 *  callers show the specific "text rejected" message. */
function rethrowModeration(err: unknown): never {
  const details = (err as { details?: { reason?: string } })?.details;
  if (details?.reason === "moderation") throw new ModerationError();
  throw err;
}

/**
 * Log a swim. The session doc and the user's score are written server-side
 * by the `logSession` Cloud Function (clients can't write either directly),
 * so scoring can't be forged. We only upload the photo here — the function
 * records its URL/path and computes points + uniqueness + winter.
 */
export async function createSession(opts: {
  uid: string;
  place: PlacePin;
  lat: number;
  lng: number;
  date: number;
  note?: string;
  photoFile?: File | null;
  /** Pre-resolved country (ISO alpha-2) — flags home vs. abroad swims. */
  country?: string | null;
  /** The swimmer's chosen border id — stamped onto the place for the map. */
  border?: string;
  /** Water temperature in °C reported by the swimmer. */
  waterTemp?: number;
}): Promise<LoggedSession> {
  let photoUrl: string | undefined;
  let photoPath: string | undefined;
  let photoThumb: string | undefined;
  if (opts.photoFile) {
    const uploaded = await uploadSessionPhoto(opts.uid, opts.photoFile);
    photoUrl = uploaded.url;
    photoPath = uploaded.path;
    photoThumb = uploaded.thumb;
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
      waterTemp?: number;
    },
    LoggedSession
  >("logSession");
  try {
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
      waterTemp: opts.waterTemp,
    });
    return res.data;
  } catch (err) {
    // The function's authoritative moderation check flags its rejection
    // via details — surface it as the same error the client-side
    // pre-checks throw so callers show one specific message.
    rethrowModeration(err);
  }
}

export type SessionEdits = {
  /** New swim timestamp (ms epoch). Omit to keep the current one. */
  date?: number;
  /** New note text. Omit to keep, null (or blank) to clear. */
  note?: string | null;
  /** New photo file to upload, null to remove the photo, omit to keep. */
  photoFile?: File | null;
  /** New water temperature (°C), null to clear, omit to keep. */
  waterTemp?: number | null;
};

/**
 * Edit a swim's date, note, or photo via the `updateSession` Cloud Function,
 * which recomputes points/isWinter and the owner's per-year score server-side
 * (sessions stay client-unwritable). A new photo is uploaded to Storage here
 * first — the function stores its URL/path and cleans up the old object.
 */
export async function updateSession(
  session: SessionDoc,
  edits: SessionEdits,
): Promise<void> {
  let photo: { url: string; path: string; thumb?: string } | null | undefined;
  if (edits.photoFile === null) photo = null;
  else if (edits.photoFile) {
    const uploaded = await uploadSessionPhoto(session.uid, edits.photoFile);
    photo = {
      url: uploaded.url,
      path: uploaded.path,
      // Key-by-key for the same reason as below: undefined would encode
      // as null, which is fine here but sloppy — just omit a missing thumb.
      ...(uploaded.thumb !== undefined ? { thumb: uploaded.thumb } : {}),
    };
  }

  const callable = cloudFn<
    {
      sessionId: string;
      date?: number;
      note?: string | null;
      photo?: { url: string; path: string; thumb?: string } | null;
      waterTemp?: number | null;
    },
    { ok: true; points: number; isWinter: boolean }
  >("updateSession");
  try {
    // Build the payload key-by-key: the Functions client encodes `undefined`
    // as null, and null means "clear" server-side — absent means "keep".
    await callable({
      sessionId: session.id,
      ...(edits.date !== undefined ? { date: edits.date } : {}),
      ...(edits.note !== undefined ? { note: edits.note } : {}),
      ...(photo !== undefined ? { photo } : {}),
      ...(edits.waterTemp !== undefined ? { waterTemp: edits.waterTemp } : {}),
    });
  } catch (err) {
    rethrowModeration(err);
  }
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

/**
 * Subscribe to a fixed set of users' sessions within a half-open time range
 * `[startMs, endExclusiveMs)`. Backs both the year-bounded group board and the
 * timespan-scoped competition board. `endExclusiveMs` may be Infinity for an
 * open-ended range, in which case the upper `date <` clause is dropped so the
 * query stays a single (uid, date DESC) index scan.
 */
export function watchMemberSessionsRange(
  uids: string[],
  startMs: number,
  endExclusiveMs: number,
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
  const unsubs = chunks.map((chunk, idx) => {
    const clauses = [
      where("uid", "in", chunk),
      where("date", ">=", startMs),
      ...(Number.isFinite(endExclusiveMs)
        ? [where("date", "<", endExclusiveMs)]
        : []),
      // Matches the existing (uid, date DESC) composite index.
      orderBy("date", "desc"),
    ];
    return onSnapshot(query(sessionsCol, ...clauses), (snap) => {
      results.set(
        String(idx),
        snap.docs.map((d) => d.data() as SessionDoc),
      );
      cb([...results.values()].flat());
    });
  });
  return () => unsubs.forEach((u) => u());
}

/**
 * Subscribe to this year's sessions for a fixed set of users (e.g. a group).
 * Year-bounded like `watchAllSessions` — the group board compares the
 * current season, and an unbounded query would re-download every member's
 * full history and keep growing each year. Thin wrapper over
 * `watchMemberSessionsRange`.
 */
export function watchMemberSessions(
  uids: string[],
  cb: (sessions: SessionDoc[]) => void,
  year: number = new Date().getFullYear(),
): Unsubscribe {
  const start = new Date(year, 0, 1).getTime();
  const end = new Date(year + 1, 0, 1).getTime();
  return watchMemberSessionsRange(uids, start, end, cb);
}

/**
 * One-shot: the uid of whoever swam most recently among `uids` (any year),
 * or null when none of them has ever logged a swim. One limit(1) query per
 * 30-uid chunk (the `in` cap) — a handful of doc reads, not a feed — using
 * the same (uid, date DESC) composite index as the member-session queries.
 * Drives the leaderboard's default-to-the-freshest-group tab choice.
 */
export async function fetchLatestSwimUid(
  uids: string[],
): Promise<string | null> {
  if (uids.length === 0) return null;
  const chunks: string[][] = [];
  for (let i = 0; i < uids.length; i += 30) chunks.push(uids.slice(i, i + 30));
  let best: SessionDoc | null = null;
  await Promise.all(
    chunks.map(async (chunk) => {
      const snap = await getDocs(
        query(
          sessionsCol,
          where("uid", "in", chunk),
          orderBy("date", "desc"),
          limit(1),
        ),
      );
      const s = snap.docs[0]?.data() as SessionDoc | undefined;
      if (s && (best === null || s.date > best.date)) best = s;
    }),
  );
  return best ? (best as SessionDoc).uid : null;
}

/**
 * One-shot: epoch ms of the most recent swim among `uids` (any year),
 * or null when none of them has ever logged a swim.
 */
export async function fetchLatestSwimAt(
  uids: string[],
): Promise<number | null> {
  if (uids.length === 0) return null;
  const chunks: string[][] = [];
  for (let i = 0; i < uids.length; i += 30) chunks.push(uids.slice(i, i + 30));
  let bestDate: number | null = null;
  await Promise.all(
    chunks.map(async (chunk) => {
      const snap = await getDocs(
        query(
          sessionsCol,
          where("uid", "in", chunk),
          orderBy("date", "desc"),
          limit(1),
        ),
      );
      const s = snap.docs[0]?.data() as SessionDoc | undefined;
      if (s && (bestDate === null || s.date > bestDate)) bestDate = s.date;
    }),
  );
  return bestDate;
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
 * Reactor UIDs for a single emoji entry, tolerant of both the current
 * `{ uid: addedAt }` map shape and the legacy `uid[]` array shape.
 */
export function reactorUids(
  entry: Record<string, number> | string[] | undefined,
): string[] {
  if (!entry) return [];
  return Array.isArray(entry) ? entry : Object.keys(entry);
}

/**
 * Epoch ms when `uid` added their reaction for this emoji entry, or 0 when
 * unknown (legacy array-shaped reactions carried no timestamp).
 */
export function reactionAddedAt(
  entry: Record<string, number> | string[] | undefined,
  uid: string,
): number {
  if (!entry || Array.isArray(entry)) return 0;
  return entry[uid] ?? 0;
}

/**
 * Toggle an emoji reaction on a session. If the user has already reacted
 * with this emoji, remove them; otherwise add them with the current time as
 * the reaction timestamp (used by the "while you were away" recap).
 */
export async function toggleReaction(
  sessionId: string,
  emoji: string,
  uid: string,
  hasReacted: boolean,
): Promise<void> {
  const ref = doc(sessionsCol, sessionId);
  const field = `reactions.${emoji}.${uid}`;
  if (hasReacted) {
    await updateDoc(ref, { [field]: deleteField() });
  } else {
    await updateDoc(ref, { [field]: Date.now() });
  }
}

// ---------- Groups ----------

export async function createGroup(opts: {
  name: string;
  uid: string;
  /** Optional competition timespan (day-start epoch ms; endDate inclusive). */
  startDate?: number;
  endDate?: number;
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
    // Only persist timespan bounds that were actually set — leaving them off
    // keeps the doc (and the Firestore rules) simple for the common case.
    ...(opts.startDate != null ? { startDate: opts.startDate } : {}),
    ...(opts.endDate != null ? { endDate: opts.endDate } : {}),
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

/**
 * Group creator updates name, emoji, and/or the competition timespan.
 * Pass a number to set a date bound, or `null` to clear it (deleteField).
 * `undefined` leaves a field untouched.
 */
export async function updateGroupMeta(
  groupId: string,
  opts: {
    name?: string;
    emoji?: string;
    startDate?: number | null;
    endDate?: number | null;
  },
): Promise<void> {
  const updates: Record<
    string,
    string | number | ReturnType<typeof deleteField>
  > = {};
  if (opts.name !== undefined) updates.name = opts.name.trim();
  if (opts.emoji !== undefined) updates.emoji = opts.emoji;
  if (opts.startDate !== undefined)
    updates.startDate =
      opts.startDate === null ? deleteField() : opts.startDate;
  if (opts.endDate !== undefined)
    updates.endDate = opts.endDate === null ? deleteField() : opts.endDate;
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

/**
 * Minimum total points (summed across every year) before a user may
 * contribute place info or toggle the naturist flag. UX gate only — the
 * Cloud Function enforces the same bar server-side. Matches
 * MIN_INFO_POINTS in functions/index.js — keep in sync.
 */
export const MIN_INFO_POINTS = 20;

/** Sum a user's points across every year, for the MIN_INFO_POINTS gate. */
export function totalPoints(scores: Record<string, number> | undefined) {
  return Object.values(scores ?? {}).reduce(
    (sum, v) => sum + (typeof v === "number" ? v : 0),
    0,
  );
}

/**
 * Add, edit, or clear (info = null) a place's description, optionally
 * flagging the spot as a naturist bath. Runs through the `setPlaceInfo`
 * Cloud Function, which enforces who may write (MIN_INFO_POINTS, add
 * when empty, edit your own, admins anything), moderates the text, and
 * stamps attribution. Returns the state as stored (trimmed/capped).
 */
export async function setPlaceInfo(
  placeId: string,
  info: string | null,
  nude?: boolean,
) {
  const callable = cloudFn<
    { placeId: string; info: string | null; nude?: boolean },
    { ok: true; info: string | null; nude: boolean }
  >("setPlaceInfo");
  const res = await callable({
    placeId,
    info,
    ...(nude !== undefined ? { nude } : {}),
  });
  return res.data;
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
  // Stamp the delta cursor so the rename reaches every client before the next
  // nightly placesSummary build (rules allow name + updatedAt together).
  await updateDoc(doc(placesCol, placeId), {
    name: trimmed,
    updatedAt: Date.now(),
  });
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
  // hammering the function with a burst. The serialization is intentional, so
  // the awaited-in-loop is by design, not an oversight.
  // react-doctor-disable-next-line react-doctor/async-await-in-loop
  for (const s of sessions.docs) await removeSession(s.id);
  await deleteDoc(doc(placesCol, placeId));
}

/** Every user (admin view). Readable by any signed-in user per the rules. */
export async function fetchAllUsers(): Promise<UserDoc[]> {
  const snap = await getDocs(usersCol);
  return snap.docs
    .map((d) => d.data() as UserDoc)
    .toSorted((a, b) =>
      (a.displayName ?? "").localeCompare(b.displayName ?? "", undefined, {
        sensitivity: "base",
      }),
    );
}

/** The ban audit list, most-recent first (admin view). */
export async function fetchBannedUsers(): Promise<BannedUser[]> {
  const snap = await getDocs(collection(db, "bannedUsers"));
  return snap.docs
    .map((d) => d.data() as BannedUser)
    .toSorted((a, b) => b.bannedAt - a.bannedAt);
}

/**
 * Ban a user via the admin-only `banUser` Cloud Function: wipes their app
 * data and disables their Firebase Auth account so they can't sign back in.
 */
export async function banUser(uid: string): Promise<void> {
  const callable = cloudFn<{ uid: string }, { ok: true }>("banUser");
  await callable({ uid });
}
