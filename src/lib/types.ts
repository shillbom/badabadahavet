export type LatLng = { lat: number; lng: number };

export type UserDoc = {
  uid: string;
  displayName: string;
  emoji?: string;
  groups: string[];
  createdAt: number;
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
