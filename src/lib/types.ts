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

/** The upstream feeds a water-temperature reading can come from. */
export type TempProvider = "havochvatten" | "smhi" | "open-meteo";

/** One water-temperature reading. Field names are single letters because
 *  thousands of these are packed into the one `tempSummary/current` doc
 *  (doc-size budget): t = °C, at = epoch ms sampled, p = producing feed. */
export type TempReading = { t: number; at: number; p: TempProvider };

/** tempSummary/current — every place's latest reading keyed by placeId,
 *  rebuilt by the daily sweep (scripts/update-temperatures.mjs). Clients
 *  subscribe to this single doc instead of receiving each temp write as a
 *  per-place snapshot delta, which is what keeps the always-on `places`
 *  listener quiet (temps are the collection's highest-churn data). */
export type TempSummaryDoc = {
  updatedAt: number;
  entries: Record<string, TempReading>;
};

/** placeTemps/{placeId} — the latest reading for one place, written by the
 *  refreshPlaceTemp Cloud Function (and the daily sweep). Only the open
 *  spot subscribes to it, so on-demand refreshes reach that viewer live
 *  without fanning out to every client. Reading fields are absent when no
 *  upstream has ever produced data for the place. */
export type PlaceTempDoc = Partial<TempReading> & {
  placeId: string;
  /** Epoch ms of the last upstream fetch *attempt* — throttles re-fetches
   *  for spots whose feeds keep coming back empty. */
  checkedAt?: number;
};

/** A place with its current reading merged in — the shape `derive()` hands
 *  to the map/UI, field-compatible with the pre-split PlaceDoc so temp
 *  consumers (pins, popups, nudge) didn't have to change. */
export type PlaceWithTemp = PlaceDoc & {
  /** Latest measured water temperature in °C (if known). */
  waterTemp?: number;
  /** Epoch ms — when waterTemp was sampled. */
  waterTempAt?: number;
  /** Which upstream actually produced the current `waterTemp`. Distinct
   *  from `tempSource` (the preference) — a "havochvatten" or "smhi" place
   *  can end up with an "open-meteo" reading when its preferred feed has
   *  none. */
  waterTempProvider?: TempProvider;
};

/** One active advisory against bathing (Hav och Vatten "avrådan"), pulled
 *  from the badplatsen detail doc's `dissuasion` array. HaV leaves expired
 *  advisories in the feed, so the sync keeps only current-season starts. */
export type WaterAdvisory = {
  /** HaV category code — 1 = unfit water sample, 99 = whole-season advisory
   *  (mapped to bilingual labels in the UI; unknown codes get a generic one). */
  type: number;
  /** Epoch ms the advisory started. */
  at: number;
  /** The municipality's free-text detail (Swedish, as with `info`). */
  text?: string;
};

/** Official water-quality snapshot synced from the Hav och Vatten badplatsen
 *  detail doc — the same response the temperature comes from. Written only
 *  onto `havochvatten` places by the daily sweep (low-churn, change-detected,
 *  the same place-doc pattern as `info`), never by clients. Numeric codes are
 *  stored raw and mapped to bilingual labels in the UI (see
 *  src/lib/waterQuality.ts). Sample-based fields reflect the latest lab
 *  sample, which is seasonal and can be weeks/months old — consumers gate on
 *  freshness and always surface `sampleAt`. */
export type WaterQuality = {
  /** Latest lab-sample verdict (E. coli + intestinal enterococci based):
   *  1 Tjänligt · 2 Tjänligt m. anm. · 3 Otjänligt · 4 Uppgift saknas. */
  sampleValue?: number;
  /** Epoch ms of that sample. */
  sampleAt?: number;
  /** Algae/cyanobacteria bloom at the latest sample:
   *  3 Blomning · 4 Ingen blomning · 5 Ingen uppgift. */
  algae?: number;
  /** EU multi-year bathing-water classification:
   *  0 Ej klassificerad · 1 Utmärkt · 2 Bra · 3 Tillfredsställande ·
   *  4 Dålig · 6 Ny badplats. */
  classification?: number;
  /** Year the `classification` applies to. */
  classificationYear?: number;
  /** Current-season advisories against bathing (avrådan), most recent first;
   *  absent when there are none. */
  advisories?: WaterAdvisory[];
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
   *  reading for a place whose official feed has nothing. (A preference, not
   *  a reading — readings live in tempSummary/placeTemps.) */
  tempSource?: TempProvider;
  /** Free-form description of the spot (facilities, bottom, access…).
   *  Synced from the official source by the temperature job, or added by
   *  a user through the setPlaceInfo Cloud Function (which moderates it).
   *  Capped server-side — keep the limits in functions/index.js and
   *  scripts/update-temperatures.mjs in sync. */
  info?: string;
  /** Where `info` came from: "havochvatten.se" for synced official text,
   *  "user" for user-contributed text. The sync never overwrites user
   *  info, and non-admin users can't overwrite official info. */
  infoSource?: string;
  /** Link to the original source page (official info only). */
  infoUrl?: string;
  /** uid + display name of the contributor (user info only). */
  infoBy?: string;
  infoByName?: string;
  /** Epoch ms — when `info` last changed. */
  infoUpdatedAt?: number;
  /** Epoch ms — when the sync job last *checked* the official source for
   *  info (distinct from infoUpdatedAt: bookkeeping so the daily run only
   *  re-checks each place's description monthly). */
  infoSyncedAt?: number;
  /** Official water-quality checks (algae bloom, latest sample verdict,
   *  advisories, EU classification) synced from Hav och Vatten by the daily
   *  sweep for `havochvatten` places. Absent when none is known. */
  waterQuality?: WaterQuality;
  /** Epoch ms — when the sweep last *checked* the source for water quality
   *  (bookkeeping so blooms are re-checked promptly; see
   *  scripts/update-temperatures.mjs). */
  qualitySyncedAt?: number;
  /** True for naturist (nude bathing) spots. Set through setPlaceInfo by
   *  users with enough points, or seeded from naturism.se. An explicit
   *  `false` is a tombstone: a user unflagged the spot, and the seed
   *  script must not re-flag it. */
  nude?: boolean;
  /** Where the nude flag came from: "naturism.se" or "user". */
  nudeSource?: string;
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
