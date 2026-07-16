import { create } from "zustand";
import { analyticsConfigured, applyAnalyticsConsent } from "@/firebase";

// Analytics consent. `null` means the user hasn't chosen yet — we collect
// nothing until they explicitly opt in (EU opt-in model). The choice persists
// per browser in localStorage, mirroring the useLocale store pattern.
export type ConsentChoice = "granted" | "denied";

const STORAGE_KEY = "badligan.consent.analytics";

function readStored(): ConsentChoice | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "granted" || v === "denied" ? v : null;
}

type ConsentState = {
  analytics: ConsentChoice | null;
  setAnalytics: (granted: boolean) => void;
};

export const useConsent = create<ConsentState>((set) => ({
  analytics: readStored(),
  setAnalytics: (granted) => {
    const choice: ConsentChoice = granted ? "granted" : "denied";
    if (typeof window !== "undefined")
      localStorage.setItem(STORAGE_KEY, choice);
    applyAnalyticsConsent(granted);
    set({ analytics: choice });
  },
}));

// Whether asking for consent is meaningful in this environment (drives the
// banner and the privacy-page toggle). Re-exported so components don't need
// to reach into the firebase module.
export const consentRelevant = analyticsConfigured;

// On boot, honour a previously granted choice so analytics resumes. A "denied"
// or absent choice does nothing, so analytics never starts without opt-in.
if (readStored() === "granted") applyAnalyticsConsent(true);
