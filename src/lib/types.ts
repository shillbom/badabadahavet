export type LatLng = { lat: number; lng: number };

export type UserDoc = {
  uid: string;
  displayName: string;
  emoji?: string;
  groups: string[];
  achievements?: Record<string, number>; // id -> unlocked timestamp
  createdAt: number;
  /** Set only via direct Firestore write (e.g. `firebase firestore:write`
   *  or the console). Rules forbid the user from toggling this themselves. */
  isAdmin?: boolean;
};

export type PlaceDoc = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  createdBy: string;
  firstSwumAt: number;
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
  points: number;
  createdAt: number;
};

export type GroupDoc = {
  id: string;
  name: string;
  code: string;
  members: string[];
  createdBy: string;
  createdAt: number;
};
