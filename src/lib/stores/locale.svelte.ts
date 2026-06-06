import { browser } from "$app/environment";

export type Locale = "sv" | "en";

const STORAGE_KEY = "badligan.locale";

function detectInitial(): Locale {
  if (!browser) return "sv";
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "sv" || saved === "en") return saved;
  // Default to Swedish unless the browser strongly prefers English.
  const langs = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];
  for (const l of langs) {
    if (l?.toLowerCase().startsWith("sv")) return "sv";
    if (l?.toLowerCase().startsWith("en")) return "en";
  }
  return "sv";
}

/**
 * Global locale, converted from the original Zustand `useLocale` store to a
 * native Svelte 5 reactive class. Anything that reads `localeStore.current`
 * inside a component (directly or via `t()`) re-renders when it changes.
 */
class LocaleStore {
  current = $state<Locale>(detectInitial());

  set(l: Locale) {
    if (browser) localStorage.setItem(STORAGE_KEY, l);
    this.current = l;
    if (browser) document.documentElement.lang = l;
  }
}

export const localeStore = new LocaleStore();

if (browser) document.documentElement.lang = localeStore.current;
