export type LatLng = { lat: number; lng: number };

export type UserDoc = {
  uid: string;
  displayName: string;
  emoji?: string;
  achievements?: Record<string, number>; // id -> unlocked timestamp
  /** Per-year swim points, keyed by calendar year ("2026" -> points).
   *  Maintained server-side by the logSession / removeSession Cloud
   *  Functions only — clients can't write it (enforced by rules). */
  scores?: Record<string, number>;
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
  /** Epoch ms of the user's previous app visit. Drives the "since your last
   *  visit" recap. Stored server-side (not per-device) so the recap is
   *  consistent across the user's devices and reinstalls. */
  lastVisit?: number;
  /** Reaction counts (from other people) on each of the user's own swims as
   *  of `lastVisit`, keyed by session id. Only swims that had reactions are
   *  stored. Reactions carry no timestamp, so the recap diffs current counts
   *  against this snapshot to find new ones. */
  lastVisitReactions?: Record<string, number>;
  /** "Want to swim" list — keyed by placeId. Whether an entry is "done" is
   *  derived from the user's sessions at that place, not stored here. */
  toswim?: Record<string, ToswimEntry>;
};

export type ToswimEntry = {
  addedAt: number;
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
   *  tries the official SE feed first and falls back to Open-Meteo; the
   *  default (or "open-meteo") goes straight to Open-Meteo satellite data. */
  tempSource?: "havochvatten" | "open-meteo";
  /** Latest measured water temperature in °C (if known). */
  waterTemp?: number;
  /** Epoch ms — when waterTemp was sampled. */
  waterTempAt?: number;
  /** Which upstream actually produced the current `waterTemp`. Distinct
   *  from `tempSource` (the preference) — a "havochvatten" place can end
   *  up with an "open-meteo" reading when the official feed has none. */
  waterTempProvider?: "havochvatten" | "open-meteo";
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
  /** Emoji reactions: key = emoji, value = list of UIDs who reacted. */
  reactions?: Record<string, string[]>;
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
