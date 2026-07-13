// Client-side profanity check for display names, backed by the
// wordlist-based `glin-profanity`. This complements the Perspective API
// pre-check in moderation.ts: Perspective is ML/contextual and fails OPEN
// on network errors, whereas this is deterministic, offline, and catches
// explicit slurs the moment the user submits — so an obviously profane
// name is rejected even when Perspective is unreachable.
//
// glin only matches whole words, which misses profanity concatenated into a
// name ("penisDikatorn", "BigDick99"). Dropping word boundaries would catch
// those but is a false-positive minefield in Swedish (it flags "analys",
// "kass", "Kukkola", and the everyday word "slut" = "the end"), so instead
// we (1) split names on separators and camelCase humps and whole-word-check
// each piece, and (2) plain-substring-match a small blocklist of long,
// unambiguous roots. Both the config and the blocklist are mirrored in
// scripts/scrub-usernames.mjs — keep the two in sync.

import { ModerationError } from "./moderation";
import type { Filter, FilterConfig } from "glin-profanity";

// Swedish + English (the app's two languages). Leetspeak + Unicode
// normalization catch "f4ck"/"fück"-style evasion; `replaceWith` makes
// checkProfanity emit the censored variant used by the scrub script.
export const USERNAME_FILTER_CONFIG: FilterConfig = {
  languages: ["swedish", "english"],
  replaceWith: "***",
  detectLeetspeak: true,
  normalizeUnicode: true,
};

// Roots matched anywhere in the (normalized) name via plain `includes` — no
// fuzzy matching (glin's fuzzy mode flags "penningar" as "penis"). ONLY long,
// unambiguous terms that don't occur inside legitimate Swedish words or
// names: deliberately NOT "ass"/"anal"/"kuk"/"fitt"/"slut"/"hora"/"dick",
// which would hit "kass", "analys", "Kukkola", "Fittja", "slutstation",
// "Thora", "Dickson". Lowercase run-togethers of those short roots
// ("kukjävel") are the accepted blind spot — catching them can't be done
// without flagging real names.
export const PROFANITY_SUBSTRINGS = [
  "penis",
  "vagina",
  "pussy",
  "knull",
  "runka",
  "kuksug",
  "kuken",
  "fitta",
  "blowjob",
  "analsex",
  "cumshot",
  "gangbang",
  "dickhead",
  "cockhead",
  "fuckface",
  "motherfuck",
  "asshole",
];

/** Split on separators/digits and camelCase humps so an embedded word is
 *  checked as a whole word ("penisDikatorn" → "penis", "BigDick99" → "Dick")
 *  without the substring false positives that dropping word boundaries brings. */
export function nameSegments(name: string): string[] {
  return name
    .replace(/([a-zåäö])([A-ZÅÄÖ])/g, "$1 $2") // camelCase hump
    .replace(/([A-ZÅÄÖ]+)([A-ZÅÄÖ][a-zåäö])/g, "$1 $2") // ACRONYMWord
    .split(/[^A-Za-zÅÄÖåäö]+/) // digits, spaces, punctuation
    .filter(Boolean);
}

// glin-profanity ships every language's wordlist (~29 KB gzipped) and its
// dictionary object isn't tree-shakeable, so it's imported lazily — only
// when a name is actually validated — to keep it out of the login /
// first-paint chunk (same reasoning as the lazily-loaded map chunk).
type Glin = typeof import("glin-profanity");
let libPromise: Promise<{ filter: Filter; lib: Glin }> | null = null;
function load(): Promise<{ filter: Filter; lib: Glin }> {
  if (!libPromise) {
    libPromise = import("glin-profanity").then((lib) => ({
      filter: new lib.Filter(USERNAME_FILTER_CONFIG),
      lib,
    }));
  }
  return libPromise;
}

/** True when the name contains a profane word in Swedish or English. */
export async function usernameHasProfanity(name: string): Promise<boolean> {
  if (!name.trim()) return false;
  const { filter, lib } = await load();
  if (filter.checkProfanity(name).containsProfanity) return true;
  if (
    nameSegments(name).some((s) => filter.checkProfanity(s).containsProfanity)
  )
    return true;
  const normalized = lib.normalizeLeetspeak(
    lib.normalizeUnicode(name.toLowerCase()),
  );
  return PROFANITY_SUBSTRINGS.some((w) => normalized.includes(w));
}

/** Throws `ModerationError` (mapped to a toast by callers) if `name` is profane. */
export async function assertUsernameClean(name: string): Promise<void> {
  if (await usernameHasProfanity(name)) throw new ModerationError();
}
