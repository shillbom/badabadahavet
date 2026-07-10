export type LatLng = { lat: number; lng: number };

/** Leaderboard card stats for one calendar year — see UserDoc.statsByYear. */
export type YearStats = {
  swims: number;
  uniquePlaces: number;
  winters: number;
  countriesAbroad: number;
};

export type UserDoc = {
  uid: string;
  displayName: string;
  emoji?: string;
  achievements?: Record<string, number>; // id -> unlocked timestamp
  /** Per-year swim points, keyed by calendar year ("2026" -> points).
   *  Maintained server-side by the logSession / removeSession Cloud
   *  Functions only — clients can't write it (enforced by rules). */
  scores?: Record<string, number>;
  /** Per-year leaderboard stats, keyed like `scores` ("2026" -> stats).
   *  Maintained server-side alongside the score by the logSession /
   *  removeSession Cloud Functions only — clients can't write it. */
  statsByYear?: Record<string, YearStats>;
  /** Chosen cosmetic pin/avatar border id (see lib/borders.ts). Falls back
   *  to the highest earned tier when unset or no longer qualified-for. */
  selectedBorder?: string;
  locale?: "sv" | "en";
  /** ISO 3166-1 alpha-2 (e.g. "SE"). Used only to tally distinct foreign
   *  countries for the "countries abroad" stat — it does not affect points. */
  homeCountry?: string;
  createdAt: number;
  /** Set only via direct Firestore write (e.g. `firebase firestore:write`
   *  or the console). Rules forbid the user from toggling this themselves. */
  isAdmin?: boolean;
  /** Last known geolocation — used as the map starting point. */
  lastLocation?: { lat: number; lng: number };
  /** Epoch ms of the user's previous visit. Stamped to "now" on every app
   *  boot; the value read at boot is the *previous* visit, which powers the
   *  "while you were away" digest (new swims + reactions since you last
   *  looked). Owner-writable — it's a personal, low-stakes field. */
  lastSeenAt?: number;
  /** "Want to swim" list — keyed by placeId. Whether an entry is "done" is
   *  derived from the user's sessions at that place, not stored here. */
  toswim?: Record<string, ToswimEntry>;
};

export type ToswimEntry = {
  addedAt: number;
};

/** Audit record for a banned user, written by the banUser Cloud Function. */
export type BannedUser = {
  uid: string;
  displayName: string | null;
  email: string | null;
  bannedAt: number;
  bannedBy: string;
};

export type PlaceDoc = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  createdBy: string;
  firstSwumAt: number;
  /** True for places imported from an external dataset (e.g. badplatsen). */
  seeded?: boolean;
  /** Free-form source label, e.g. "havochvatten.se". */
  source?: string;
  /** External provider's identifier (e.g. badplatsen nutsCode). */
  externalId?: string;
  /** Which upstream the temperature refresh should prefer. "havochvatten"
   *  tries the official SE bathing-spot feed first, then the nearest SMHI
   *  ocean-observation station, then Open-Meteo; "smhi" tries the nearest
   *  SMHI station first and falls back to Open-Meteo. The default (or
   *  "open-meteo") goes straight to Open-Meteo satellite data. Auto-promoted
   *  from "havochvatten" to "smhi" server-side once SMHI actually supplies a
   *  reading for a place whose official feed has nothing. */
  tempSource?: "havochvatten" | "smhi" | "open-meteo";
  /** Latest measured water temperature in °C (if known). */
  waterTemp?: number;
  /** Epoch ms — when waterTemp was sampled. */
  waterTempAt?: number;
  /** Which upstream actually produced the current `waterTemp`. Distinct
   *  from `tempSource` (the preference) — a "havochvatten" or "smhi" place
   *  can end up with an "open-meteo" reading when its preferred feed has
   *  none. */
  waterTempProvider?: "havochvatten" | "smhi" | "open-meteo";
  /** Denormalised "last swim here", maintained by the logSession /
   *  removeSession Cloud Functions. Lets the map outline each pin with the
   *  most recent swimmer's frame without loading any sessions. */
  lastSwimAt?: number;
  lastSwimBy?: string;
  /** Border id (see lib/borders.ts) of that last swimmer; "none" = no frame. */
  lastSwimBorder?: string;
};

export type SessionDoc = {
  id: string;
  uid: string;
  displayName: string;
  placeId: string;
  placeName: string;
  lat: number;
  lng: number;
  date: number; // ms epoch
  note?: string;
  photoUrl?: string;
  /** Storage path the photo was uploaded to, used for clean-up. */
  photoPath?: string;
  /** Tiny inline base64 JPEG (LQIP) shown blurred until photoUrl loads. */
  photoThumb?: string;
  isUniqueForUser: boolean;
  isWinter: boolean;
  /** True if the swim was in the user's registered home country. */
  isHomeCountry?: boolean;
  /** ISO 3166-1 alpha-2 from reverse geocoding ("SE", "NO", …). */
  country?: string;
  /** The swimmer's chosen border id at log time (see lib/borders.ts). */
  border?: string;
  points: number;
  createdAt: number;
  /** Emoji reactions: key = emoji, value = a map of reactor UID -> epoch ms
   *  when they reacted. The timestamp powers the "while you were away" recap
   *  (so we can tell which reactions are new since your last visit).
   *  Legacy docs may still hold a plain UID array with no timestamps — read
   *  via the `reactorUids` / `reactionAddedAt` helpers in lib/data, which
   *  tolerate both shapes. */
  reactions?: Record<string, Record<string, number> | string[]>;
};

export type GroupDoc = {
  id: string;
  name: string;
  /** Optional emoji icon chosen by the group creator. */
  emoji?: string;
  code: string;
  members: string[];
  createdBy: string;
  createdAt: number;
};
