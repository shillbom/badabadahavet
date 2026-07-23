export type LatLng = { lat: number; lng: number };

/** Leaderboard card stats for one calendar year — see UserDoc.statsByYear. */
export type YearStats = {
  swims: number;
  uniquePlaces: number;
  winters: number;
  countriesAbroad: number;
};

/** One row of the global top-5 snapshot (`leaderboard/{year}`). Mirrors the
 *  fields a leaderboard row needs so guests can render the board without
 *  reading individual user docs. Built server-side by functions/leaderboard.js. */
export type LeaderboardEntry = {
  uid: string;
  displayName: string;
  points: number;
  stats: YearStats | null;
  /** Chosen border id — resolved client-side against `achievements`. */
  selectedBorder?: string;
  /** Earned achievement ids (id -> timestamp); only the keys are used. */
  achievements?: Record<string, number>;
};

/** World-readable global leaderboard snapshot for one year. Maintained by the
 *  scoring Cloud Functions and rebuilt by scripts/backfill-toplist.mjs. */
export type LeaderboardDoc = {
  year: number;
  top: LeaderboardEntry[];
  updatedAt: number;
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

/** The upstream feeds a water-temperature reading can come from, plus "user" for reported temps. */
export type TempProvider = "havochvatten" | "smhi" | "open-meteo";
export type TempSource = TempProvider | "user";

/** One water-temperature reading. Field names are single letters because
 *  thousands of these are packed into the one `tempSummary/current` doc
 *  (doc-size budget): t = °C, at = epoch ms sampled, p = producing feed. */
export type TempReading = { t: number; at: number; p: TempSource };

/** placeTempHistory/{placeId} — daily temperature readings recorded per day. */
export type PlaceTempHistoryDoc = {
  placeId: string;
  days: Record<string, { t: number; p: TempSource }>;
  updatedAt?: number;
};

/** The latest official water-quality lab sample from Hav och Vatten, pulled
 *  from the same badplatsen detail doc the temperature comes from. Packed
 *  into `tempSummary/current` alongside the temp readings — kept OFF the
 *  place docs for the same reason temps are (the always-on `places` listener
 *  would fan every change out to every client). Field names are terse for the
 *  same doc-size reason: `v` = sample verdict (1 Tjänligt · 2 Tjänligt m.
 *  anm. · 3 Otjänligt · 4 Uppgift saknas), `a` = algae (3 Blomning · 4 Ingen
 *  blomning · 5 Ingen uppgift), `at` = epoch ms the sample was taken.
 *  Sampling is seasonal and roughly biweekly, so consumers gate on freshness
 *  and always surface `at`. Codes are stored raw and mapped to bilingual
 *  labels in the UI (see src/lib/waterQuality.ts). */
export type WaterSample = { v?: number; a?: number; at: number };

/** tempSummary/current — every place's latest reading keyed by placeId,
 *  rebuilt by the daily sweep (scripts/update-temperatures.mjs). Clients
 *  subscribe to this single doc instead of receiving each temp write as a
 *  per-place snapshot delta, which is what keeps the always-on `places`
 *  listener quiet (temps are the collection's highest-churn data).
 *
 *  The `entries` and `quality` maps are exempted from indexing in
 *  firestore.indexes.json: Firestore auto-indexes every leaf field, so with
 *  thousands of places the doc blows past the 40k-index-entries-per-document
 *  cap on write (INDEX_ENTRIES_COUNT_LIMIT_EXCEEDED). Nothing queries these
 *  subfields — the doc is only ever read whole — so the exemption is free. */
export type TempSummaryDoc = {
  updatedAt: number;
  entries: Record<string, TempReading>;
  /** Latest water-quality sample per placeId (only spots sampled recently —
   *  the sweep drops entries older than ~2 weeks). Present only for Hav och
   *  Vatten baths that have a recent lab sample. */
  quality?: Record<string, WaterSample>;
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
 *  to the map/UI. Built on the lightweight PlacePin (the map, pickers and
 *  search only read display fields); the full PlaceDoc is fetched on demand
 *  by SpotPage. Temp consumers (pins, popups, nudge) read waterTemp* here. */
export type PlaceWithTemp = PlacePin & {
  /** Latest measured water temperature in °C (if known). */
  waterTemp?: number;
  /** Epoch ms — when waterTemp was sampled. */
  waterTempAt?: number;
  /** Which upstream (or "user") produced the current `waterTemp`. */
  waterTempProvider?: TempSource;
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
  /** True for naturist (nude bathing) spots. Set through setPlaceInfo by
   *  users with enough points, or seeded from naturism.se. An explicit
   *  `false` is a tombstone: a user unflagged the spot, and the seed
   *  script must not re-flag it. */
  nude?: boolean;
  /** Where the nude flag came from: "naturism.se" or "user". */
  nudeSource?: string;
  /** Epoch ms of the last create/rename/info write to this doc (wall-clock,
   *  not the swim date). The cursor for watchPlaceChangesSince — the bounded
   *  delta listener that surfaces spots created or edited since the daily
   *  placesSummary was built. Absent on docs predating the snapshot pattern;
   *  those are already in the summary, so their exclusion from the delta is
   *  correct. */
  updatedAt?: number;
};

/** A place reduced to the fields the always-on map, pickers and search
 *  actually read. This is what the store's `places` array holds — rehydrated
 *  from placesSummary/current (+ the recent-changes delta) instead of the full
 *  ~4k-doc `places` collection. The heavy fields (info, provenance,
 *  createdBy…) are fetched on demand by SpotPage via getPlace. */
export type PlacePin = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Naturist flag — present (true) only for naturist spots. */
  nude?: boolean;
  /** Denormalised "last swim here": the pin's recency glow + border frame. */
  lastSwimAt?: number;
  lastSwimBorder?: string;
};

/** One place's map-display fields, packed into placesSummary/current. Field
 *  names are single letters because thousands ride in one doc (same doc-size
 *  budget as TempReading): n = name, la = lat, lo = lng, u = naturist (present
 *  only when true), s = lastSwimAt, b = lastSwimBorder (present only when the
 *  place has a known last swim; b omitted when "none"). */
export type PlaceSummaryEntry = {
  n: string;
  la: number;
  lo: number;
  u?: true;
  s?: number;
  b?: string;
};

/** placesSummary/current — every place's lightweight map fields keyed by
 *  placeId, rebuilt by the daily sweep (scripts/update-places-summary.mjs).
 *  Clients read this single doc plus a bounded `updatedAt > builtAt` delta on
 *  `places` instead of an always-on listener over the whole (~4k-doc)
 *  collection, which re-streamed every place edit (and every swim's lastSwim*
 *  stamp) to every client. `builtAt` is the cursor for that delta.
 *
 *  `packed` is `JSON.stringify(entries)` stored as a single string field. This
 *  matters because Firestore's Listen wire protocol encodes every field with a
 *  verbose typed wrapper (`{mapValue:{fields:{n:{stringValue:…}}}}` per entry),
 *  which inflated the ~5k-entry map to ~2.2 MB on the wire — a ~10 s first load
 *  on mobile. Packing the whole payload into one `stringValue` collapses that
 *  back to the raw JSON size (~300 KB). `entries` is kept optional only so a
 *  client running new code can still read an old (pre-pack) doc until the next
 *  daily sweep rewrites it in packed form. */
export type PlacesSummaryDoc = {
  builtAt: number;
  packed?: string;
  entries?: Record<string, PlaceSummaryEntry>;
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
  /** Water temperature in °C recorded or derived for this swim. */
  waterTemp?: number;
  /** Source/provider for `waterTemp`: "user" or an upstream provider. */
  waterTempProvider?: TempSource;
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
  /** Optional competition timespan set by the group admin. When present, the
   *  group's leaderboard scores only sessions inside the range (and hides the
   *  year picker). Both bounds are optional and independent, so a range can be
   *  open-ended on either side. Stored as day-start epoch ms; `endDate` is the
   *  last *included* day (filter as `date < endDate + DAY_MS`). A range may
   *  cross calendar years (e.g. a whole summer break). */
  startDate?: number;
  endDate?: number;
};
