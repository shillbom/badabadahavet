/**
 * Water-themed emojis used as the placeholder thumbnail for photo-less swims.
 * Picking one deterministically (by session id) instead of a single fixed 🌊
 * makes a feed of note-only swims feel varied without being random — the same
 * swim always shows the same emoji across renders and reloads.
 */
export const WATER_EMOJIS = [
  "🌊",
  "💧",
  "🫧",
  "🐟",
  "🐠",
  "🐳",
  "🐬",
  "🦭",
  "🐚",
  "🏊",
  "🌀",
  "⛵",
] as const;

/**
 * Stable pick from {@link WATER_EMOJIS} for a given seed (typically a session
 * id). Same seed → same emoji; falls back to 🌊 for an empty seed. Uses a tiny
 * djb2 hash so it needs no crypto and stays in sync between server and client.
 */
export function waterEmojiFor(seed: string): string {
  if (!seed) return WATER_EMOJIS[0];
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 33) ^ seed.charCodeAt(i);
  }
  return WATER_EMOJIS[Math.abs(hash) % WATER_EMOJIS.length];
}
