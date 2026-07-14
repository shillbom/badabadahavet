/**
 * Pin / avatar borders — a cosmetic frame the user can *choose* once they've
 * earned it. Two ways to unlock a border:
 *
 *   • "count"       — reach a number of unlocked achievements (the tier
 *                     ladder: Bronze → Silver → Gold → Diamond).
 *   • "achievement" — unlock one specific achievement (themed frames like
 *                     Frost or Ember).
 *
 * The chosen border decorates "their stuff": the rings around their own
 * spots on the map and the frame around their profile avatar. If a user
 * hasn't picked one (or picks one they no longer qualify for), we fall back
 * to the highest count-tier they've earned.
 */
export type BorderUnlock =
  | { kind: "count"; min: number }
  | { kind: "achievement"; achievementId: string };

export type Border = {
  id: string;
  emoji: string;
  /** Raw colours for Leaflet pin rings (not Tailwind classes). */
  ring: string;
  glow: string;
  /** Tailwind classes for DOM frames (avatar, leaderboard medal, swatches). */
  ringClass: string;
  bgClass: string;
  textClass: string;
  unlock: BorderUnlock;
};

export const NONE_BORDER: Border = {
  id: "none",
  emoji: "",
  ring: "transparent",
  glow: "transparent",
  ringClass: "ring-white",
  bgClass: "bg-slate-100",
  textClass: "text-slate-500",
  unlock: { kind: "count", min: 0 },
};

// The count-based tier ladder, ascending. There are 17 achievements total,
// so Diamond is reachable but genuinely hard.
const TIER_BORDERS: Border[] = [
  {
    id: "bronze",
    emoji: "🥉",
    ring: "#c2772f",
    glow: "rgba(194,119,47,0.55)",
    ringClass: "ring-amber-600",
    bgClass: "bg-gradient-to-br from-amber-200 to-amber-500",
    textClass: "text-amber-700",
    unlock: { kind: "count", min: 1 },
  },
  {
    id: "silver",
    emoji: "🥈",
    ring: "#94a3b8",
    glow: "rgba(148,163,184,0.6)",
    ringClass: "ring-slate-400",
    bgClass: "bg-gradient-to-br from-slate-200 to-slate-400",
    textClass: "text-slate-600",
    unlock: { kind: "count", min: 4 },
  },
  {
    id: "gold",
    emoji: "🥇",
    ring: "#f59e0b",
    glow: "rgba(245,158,11,0.65)",
    ringClass: "ring-amber-400",
    bgClass: "bg-gradient-to-br from-amber-300 to-amber-500",
    textClass: "text-amber-600",
    unlock: { kind: "count", min: 8 },
  },
  {
    id: "diamond",
    emoji: "💎",
    ring: "#22d3ee",
    glow: "rgba(34,211,238,0.7)",
    ringClass: "ring-cyan-400",
    bgClass: "bg-gradient-to-br from-cyan-200 to-sky-400",
    textClass: "text-cyan-600",
    unlock: { kind: "count", min: 12 },
  },
];

// Themed frames, each tied to a specific achievement so unlocking that
// achievement also hands the swimmer a distinctive look to show off.
const THEMED_BORDERS: Border[] = [
  {
    id: "frost",
    emoji: "🧊",
    ring: "#7dd3fc",
    glow: "rgba(125,211,252,0.75)",
    ringClass: "ring-sky-300",
    bgClass: "bg-gradient-to-br from-sky-100 to-cyan-300",
    textClass: "text-sky-600",
    unlock: { kind: "achievement", achievementId: "WINTER_WARRIOR" },
  },
  {
    id: "ember",
    emoji: "🔥",
    ring: "#fb7185",
    glow: "rgba(251,113,133,0.7)",
    ringClass: "ring-rose-400",
    bgClass: "bg-gradient-to-br from-orange-300 to-rose-500",
    textClass: "text-rose-600",
    unlock: { kind: "achievement", achievementId: "STREAK_6" },
  },
  {
    id: "voyager",
    emoji: "🧭",
    ring: "#34d399",
    glow: "rgba(52,211,153,0.7)",
    ringClass: "ring-emerald-400",
    bgClass: "bg-gradient-to-br from-emerald-200 to-teal-500",
    textClass: "text-emerald-600",
    unlock: { kind: "achievement", achievementId: "WANDERLUST" },
  },
  {
    id: "aurora",
    emoji: "🌌",
    ring: "#a78bfa",
    glow: "rgba(167,139,250,0.7)",
    ringClass: "ring-violet-400",
    bgClass: "bg-gradient-to-br from-violet-300 via-fuchsia-300 to-emerald-300",
    textClass: "text-violet-600",
    unlock: { kind: "achievement", achievementId: "ALL_SEASONS" },
  },
];

/** Full catalog in display order: none → tiers → themed. */
export const BORDERS: Border[] = [
  NONE_BORDER,
  ...TIER_BORDERS,
  ...THEMED_BORDERS,
];

export function borderById(id: string | null | undefined): Border | undefined {
  return id ? BORDERS.find((b) => b.id === id) : undefined;
}

/** A Leaflet pin ring for a stored border id, or null for none/unknown. */
export function pinRingFor(
  id: string | null | undefined,
): { id: string; ring: string; glow: string } | null {
  const b = borderById(id);
  if (!b || b.id === "none") return null;
  return { id: b.id, ring: b.ring, glow: b.glow };
}

export function isBorderUnlocked(
  b: Border,
  achievementCount: number,
  unlocked: Set<string>,
): boolean {
  if (b.id === "none") return true;
  return b.unlock.kind === "count"
    ? achievementCount >= b.unlock.min
    : unlocked.has(b.unlock.achievementId);
}

/** Highest count-tier the user has reached (the auto default / "rank"). */
export function tierForCount(achievementCount: number): Border {
  let best = NONE_BORDER;
  for (const b of TIER_BORDERS) {
    if (achievementCount >= (b.unlock as { min: number }).min) best = b;
  }
  return best;
}

/** Next count-tier up plus how many more achievements it needs, or null at the top. */
export function nextTier(
  achievementCount: number,
): { border: Border; remaining: number } | null {
  for (const b of TIER_BORDERS) {
    const min = (b.unlock as { min: number }).min;
    if (achievementCount < min) {
      return { border: b, remaining: min - achievementCount };
    }
  }
  return null;
}

/**
 * The border to actually display: the user's pick if they still qualify for
 * it, otherwise the highest count-tier they've earned.
 */
export function resolveBorder(
  selectedId: string | null | undefined,
  achievementCount: number,
  unlocked: Set<string>,
): Border {
  const picked = borderById(selectedId);
  if (picked && isBorderUnlocked(picked, achievementCount, unlocked)) {
    return picked;
  }
  return tierForCount(achievementCount);
}
