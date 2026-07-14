import { create } from "zustand";
import { useStore } from "@/store/sessions";

/**
 * Admin mode is an opt-in view: a real admin (the `isAdmin` Firestore flag)
 * browses the app as a normal user until they switch this on from the profile
 * page. Every admin-only UI gate reads `useIsAdmin()` (real flag AND toggle),
 * so the extra powers only appear when deliberately enabled. This is a
 * device-local UI preference — the real enforcement stays in Firestore/Storage
 * rules — so it lives in localStorage like the locale preference, not on the
 * Firestore profile.
 */
const STORAGE_KEY = "badligan.adminMode";

function detectInitial(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "1";
}

type AdminModeState = {
  adminMode: boolean;
  setAdminMode: (on: boolean) => void;
};

export const useAdminMode = create<AdminModeState>((set) => ({
  adminMode: detectInitial(),
  setAdminMode: (on) => {
    if (typeof window !== "undefined") {
      if (on) localStorage.setItem(STORAGE_KEY, "1");
      else localStorage.removeItem(STORAGE_KEY);
    }
    set({ adminMode: on });
  },
}));

/** True for actual admins (the Firestore flag), regardless of the toggle.
 *  Use this only to decide whether to show the admin-mode toggle itself. */
export function useIsRealAdmin(): boolean {
  return useStore((s) => s.profile?.isAdmin === true);
}

/** Effective admin: a real admin who has admin mode switched on. Gate all
 *  admin-only UI on this so admins act like normal users by default. */
export function useIsAdmin(): boolean {
  const real = useStore((s) => s.profile?.isAdmin === true);
  const on = useAdminMode((s) => s.adminMode);
  return real && on;
}
