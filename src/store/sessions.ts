import { create } from "zustand";
import type { GroupDoc, PlaceDoc, SessionDoc } from "@/lib/types";

type State = {
  myUid: string | null;
  mySessions: SessionDoc[];
  allSessions: SessionDoc[];
  places: PlaceDoc[];
  groups: GroupDoc[];
  setMyUid: (uid: string | null) => void;
  setMySessions: (s: SessionDoc[]) => void;
  setAllSessions: (s: SessionDoc[]) => void;
  setPlaces: (p: PlaceDoc[]) => void;
  setGroups: (g: GroupDoc[]) => void;
};

export const useStore = create<State>((set) => ({
  myUid: null,
  mySessions: [],
  allSessions: [],
  places: [],
  groups: [],
  setMyUid: (uid) => set({ myUid: uid }),
  setMySessions: (mySessions) => set({ mySessions }),
  setAllSessions: (allSessions) => set({ allSessions }),
  setPlaces: (places) => set({ places }),
  setGroups: (groups) => set({ groups }),
}));
