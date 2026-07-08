import { create } from "zustand";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import type { Achievement } from "@/lib/achievements";
import type { StreakTier } from "@/lib/streak";
import { Sparkles } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import PixiLayer from "@/components/fx/PixiLayer";
import { burstFx } from "@/components/fx/celebrationFx";

type Splash =
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

type State = {
  queue: Splash[];
  show: (s: Splash) => void;
  pop: () => void;
};

export const useCelebration = create<State>((set) => ({
  queue: [],
  show: (s) => set((st) => ({ queue: [...st.queue, s] })),
  pop: () => set((st) => ({ queue: st.queue.slice(1) })),
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

// Dev-only: trigger splashes from the browser console to eyeball the
// burst effects, e.g. `celebrate.streak("disco", 55)`. Compiled out of
// production builds.
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { celebrate: typeof celebrate }).celebrate = celebrate;
}

export function CelebrationOverlay() {
  const queue = useCelebration((s) => s.queue);
  const pop = useCelebration((s) => s.pop);
  const current = queue[0];

  useEffect(() => {
    if (!current) return;
    const ms = current.kind === "swim" ? 1500 : 2400;
    const t = setTimeout(pop, ms);
    return () => clearTimeout(t);
  }, [current, pop]);

  return (
    <AnimatePresence>
      {current ? (
        <motion.div
          key={`${current.kind}-${queue.length}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none fixed inset-0 z-[3000] flex items-center justify-center bg-black/15 backdrop-blur-[1px]"
        >
          {current.kind === "swim" ? (
            <SwimSplash data={current} />
          ) : current.kind === "streak" ? (
            <StreakSplash data={current} />
          ) : (
            <AchievementSplash data={current} />
          )}
          {/* One burst per splash — keyed remount restarts the effect. */}
          <PixiLayer
            build={burstFx}
            options={{ variant: burstVariant(current) }}
            maxFPS={60}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

const TIER_EMOJI: Record<Exclude<StreakTier, "plain">, string> = {
  bubbly: "🫧",
  fire: "🔥",
  disco: "🪩",
};

/** Which confetti mix the Pixi burst uses (see celebrationFx.ts). */
function burstVariant(s: Splash): string {
  if (s.kind === "achievement") return "achievement";
  if (s.kind === "streak") return `streak-${s.tier}`;
  if (s.isWinter) return "winter";
  if (s.isNewSpot) return "newspot";
  return "swim";
}

function SwimSplash({ data }: { data: Extract<Splash, { kind: "swim" }> }) {
  const t = useT();
  return (
    <motion.div
      initial={{ scale: 0.6, opacity: 0, y: 20 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ scale: 0.6, opacity: 0, y: -20 }}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
      className="pointer-events-auto relative flex flex-col items-center"
    >
      {/* expanding rings */}
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          initial={{ scale: 0.6, opacity: 0.5 }}
          animate={{ scale: 3.5, opacity: 0 }}
          transition={{ duration: 1.2, delay: i * 0.18, ease: "easeOut" }}
          className="absolute h-32 w-32 rounded-full border-2 border-wave-400/70"
        />
      ))}
      <div className="relative flex h-32 w-32 items-center justify-center rounded-full bg-gradient-to-br from-wave-300 to-wave-700 text-6xl shadow-2xl">
        💧
      </div>
      <motion.div
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.18 }}
        className="mt-3 rounded-full bg-white/95 px-5 py-2 font-display text-2xl font-black text-wave-800 shadow-lg"
      >
        {t("celebration.swim.points", { n: data.points })}
      </motion.div>
      <div className="mt-2 flex gap-1.5">
        {data.isNewSpot ? (
          <span className="chip">
            <Sparkles className="h-3 w-3" /> {t("celebration.swim.new_spot")}
          </span>
        ) : null}
        {data.isWinter ? (
          <span className="chip bg-sky-100 text-sky-800 ring-sky-200">
            ❄️ {t("celebration.swim.winter")}
          </span>
        ) : null}
      </div>
    </motion.div>
  );
}

function StreakSplash({ data }: { data: Extract<Splash, { kind: "streak" }> }) {
  const t = useT();
  return (
    <motion.div
      initial={{ scale: 0.6, opacity: 0, y: 20 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ scale: 0.6, opacity: 0, y: -20 }}
      transition={{ type: "spring", stiffness: 320, damping: 22 }}
      className="pointer-events-auto relative flex flex-col items-center"
    >
      {/* expanding rings, tinted per tier */}
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          initial={{ scale: 0.6, opacity: 0.5 }}
          animate={{ scale: 3.5, opacity: 0 }}
          transition={{ duration: 1.2, delay: i * 0.18, ease: "easeOut" }}
          className={cn(
            "absolute h-32 w-32 rounded-full border-2",
            data.tier === "bubbly" && "border-wave-400/70",
            data.tier === "fire" && "border-orange-400/70",
            data.tier === "disco" && "border-fuchsia-400/70",
          )}
        />
      ))}
      <motion.div
        animate={
          data.tier === "disco"
            ? { rotate: [0, -6, 6, 0], scale: [1, 1.06, 1] }
            : data.tier === "fire"
              ? { scale: [1, 1.08, 1] }
              : undefined
        }
        transition={{ duration: 0.9, repeat: Infinity }}
        className={cn(
          "relative flex h-32 w-32 items-center justify-center rounded-full text-6xl shadow-2xl",
          data.tier === "bubbly" &&
            "bg-gradient-to-br from-wave-300 to-wave-700",
          data.tier === "fire" &&
            "bg-gradient-to-br from-amber-300 via-orange-500 to-red-600",
          data.tier === "disco" &&
            "bg-gradient-to-br from-fuchsia-400 via-purple-500 to-cyan-400",
        )}
      >
        {TIER_EMOJI[data.tier]}
      </motion.div>
      <motion.div
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.18 }}
        className="mt-3 rounded-full bg-white/95 px-5 py-2 font-display text-2xl font-black text-wave-800 shadow-lg"
      >
        {t("celebration.streak.days", { n: data.days })}
      </motion.div>
      <motion.div
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="mt-2 rounded-full bg-white/80 px-4 py-1 text-sm font-semibold text-slate-700 shadow"
      >
        {t(`celebration.streak.${data.tier}`)}
      </motion.div>
    </motion.div>
  );
}

function AchievementSplash({
  data,
}: {
  data: Extract<Splash, { kind: "achievement" }>;
}) {
  const t = useT();
  return (
    <motion.div
      initial={{ scale: 0.6, opacity: 0, rotate: -8 }}
      animate={{ scale: 1, opacity: 1, rotate: 0 }}
      exit={{ scale: 0.6, opacity: 0, rotate: 6 }}
      transition={{ type: "spring", stiffness: 280, damping: 18 }}
      className="pointer-events-auto relative max-w-xs"
    >
      <div className="relative flex flex-col items-center rounded-3xl bg-gradient-to-br from-amber-200 via-white to-wave-200 p-6 shadow-2xl ring-1 ring-amber-300/60">
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-amber-500 px-3 py-1 text-[10px] font-bold tracking-widest text-white uppercase shadow">
          {t("achievements.unlocked_label")}
        </div>
        <motion.div
          initial={{ y: 14, scale: 0.7, rotate: -6 }}
          animate={{ y: 0, scale: 1, rotate: 0 }}
          transition={{
            type: "spring",
            stiffness: 240,
            damping: 14,
            delay: 0.1,
          }}
          className="mt-2 flex h-24 w-24 items-center justify-center rounded-full bg-white text-5xl shadow-inner ring-4 ring-amber-300/70"
        >
          {data.achievement.emoji}
        </motion.div>
        <div className="mt-3 text-center">
          <div className="font-display text-xl font-black text-wave-900">
            {t(`achievement.${data.achievement.id}.name`)}
          </div>
          <div className="mt-0.5 text-xs text-slate-600">
            {t(`achievement.${data.achievement.id}.desc`)}
          </div>
        </div>
        <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-amber-500 px-3 py-1 text-xs font-bold text-white">
          {"★".repeat(data.achievement.tier)}
        </div>
      </div>
    </motion.div>
  );
}
