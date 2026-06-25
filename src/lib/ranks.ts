/**
 * Swimmer ranks — a visible badge of how many achievements someone has
 * unlocked. The rank decorates "their stuff": their pins on the map get a
 * coloured ring, and their avatar / leaderboard medal carries the same hue.
 *
 * Ranks are purely cosmetic (achievements already grant the bonus points);
 * they exist to make progress feel tangible and a little bit competitive.
 */
export type RankId = "none" | "bronze" | "silver" | "gold" | "diamond";

export type SwimmerRank = {
  id: RankId;
  /** Minimum unlocked achievements to reach this rank. */
  min: number;
  emoji: string;
  /** Raw colours used for Leaflet pin rings (not Tailwind classes). */
  ring: string;
  glow: string;
  /** Tailwind classes for DOM borders (profile avatar, leaderboard medal). */
  ringClass: string;
  bgClass: string;
  textClass: string;
};

// Ordered ascending by threshold. There are 17 achievements total, so the
// top rank is reachable but genuinely hard.
export const RANKS: SwimmerRank[] = [
  {
    id: "none",
    min: 0,
    emoji: "",
    ring: "transparent",
    glow: "transparent",
    ringClass: "ring-white",
    bgClass: "bg-slate-100",
    textClass: "text-slate-500",
  },
  {
    id: "bronze",
    min: 1,
    emoji: "🥉",
    ring: "#c2772f",
    glow: "rgba(194,119,47,0.55)",
    ringClass: "ring-amber-600",
    bgClass: "bg-gradient-to-br from-amber-200 to-amber-500",
    textClass: "text-amber-700",
  },
  {
    id: "silver",
    min: 4,
    emoji: "🥈",
    ring: "#94a3b8",
    glow: "rgba(148,163,184,0.6)",
    ringClass: "ring-slate-400",
    bgClass: "bg-gradient-to-br from-slate-200 to-slate-400",
    textClass: "text-slate-600",
  },
  {
    id: "gold",
    min: 8,
    emoji: "🥇",
    ring: "#f59e0b",
    glow: "rgba(245,158,11,0.65)",
    ringClass: "ring-amber-400",
    bgClass: "bg-gradient-to-br from-amber-300 to-amber-500",
    textClass: "text-amber-600",
  },
  {
    id: "diamond",
    min: 12,
    emoji: "💎",
    ring: "#22d3ee",
    glow: "rgba(34,211,238,0.7)",
    ringClass: "ring-cyan-400",
    bgClass: "bg-gradient-to-br from-cyan-200 to-sky-400",
    textClass: "text-cyan-600",
  },
];

/** Highest rank whose threshold the unlocked count meets. */
export function rankForAchievementCount(count: number): SwimmerRank {
  let best = RANKS[0];
  for (const r of RANKS) if (count >= r.min) best = r;
  return best;
}

/** The next rank up, or null if already at the top. */
export function nextRank(current: SwimmerRank): SwimmerRank | null {
  const idx = RANKS.findIndex((r) => r.id === current.id);
  return idx >= 0 && idx < RANKS.length - 1 ? RANKS[idx + 1] : null;
}
