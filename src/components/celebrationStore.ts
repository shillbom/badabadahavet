import { create } from "zustand";
import type { Achievement } from "@/lib/achievements";
import type { StreakTier } from "@/lib/streak";

export type CelebrationSplash =
  | {
      kind: "swim";
      points: number;
      isNewSpot: boolean;
      isWinter: boolean;
    }
  | {
      kind: "achievement";
      achievement: Achievement;
    }
  | {
      kind: "streak";
      tier: Exclude<StreakTier, "plain">;
      days: number;
    };

type CelebrationState = {
  queue: CelebrationSplash[];
  show: (splash: CelebrationSplash) => void;
  pop: () => void;
};

export const useCelebration = create<CelebrationState>((set) => ({
  queue: [],
  show: (splash) => set((state) => ({ queue: [...state.queue, splash] })),
  pop: () => set((state) => ({ queue: state.queue.slice(1) })),
}));

export const celebrate = {
  swim: (points: number, isNewSpot: boolean, isWinter: boolean) =>
    useCelebration
      .getState()
      .show({ kind: "swim", points, isNewSpot, isWinter }),
  achievement: (achievement: Achievement) =>
    useCelebration.getState().show({ kind: "achievement", achievement }),
  streak: (tier: Exclude<StreakTier, "plain">, days: number) =>
    useCelebration.getState().show({ kind: "streak", tier, days }),
};

if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { celebrate: typeof celebrate }).celebrate = celebrate;
}
