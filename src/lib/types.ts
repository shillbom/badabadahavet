export type LatLng = { lat: number; lng: number };

export type UserDoc = {
  uid: string;
  displayName: string;
  emoji?: string;
  achievements?: Record<string, number>; // id -> unlocked timestamp
  locale?: "sv" | "en";
  /** ISO 3166-1 alpha-2 (e.g. "SE"). Used to award home-country bracket
   *  points; non-home swims get country bonuses via rule G. */
  homeCountry?: string;
  createdAt: number;
  /** Set only via direct Firestore write (e.g. `firebase firestore:write`
   *  or the console). Rules forbid the user from toggling this themselves. */
  isAdmin?: boolean;
  /** Last known geolocation — used as the map starting point. */
  lastLocation?: { lat: number; lng: number };
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
  /** Latest measured water temperature in °C (if known). */
  waterTemp?: number;
  /** Epoch ms — when waterTemp was sampled. */
  waterTempAt?: number;
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
  isUniqueForUser: boolean;
  isWinter: boolean;
  /** True if the swim was in the user's registered home country. */
  isHomeCountry?: boolean;
  /** ISO 3166-1 alpha-2 from reverse geocoding ("SE", "NO", …). */
  country?: string;
  /** A=May–Sep, B=Apr/Oct, C=Mar/Nov, D=Jan/Feb/Dec — home-country bracket. */
  monthCategory?: "A" | "B" | "C" | "D";
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
