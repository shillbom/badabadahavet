import { create } from "zustand";

export const useRecapTrigger = create<{ token: number; open: () => void }>(
  (set) => ({
    token: 0,
    open: () => set((state) => ({ token: state.token + 1 })),
  }),
);

export function openRecap() {
  useRecapTrigger.getState().open();
}
