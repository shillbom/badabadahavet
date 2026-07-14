import { m } from "framer-motion";
import { Link } from "react-router";
import { Flame } from "lucide-react";
import { useT } from "@/lib/i18n";
import { streakLevel, streakTier, type StreakInfo } from "@/lib/streak";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import PixiLayer from "@/components/fx/PixiLayer";
import {
  bubblesFx,
  discoFx,
  edgeFireFx,
  fireFx,
} from "@/components/fx/streakFx";
import { cn } from "@/lib/utils";

/**
 * The front-page streak stat card. Escalates with the streak:
 * 3+ days — blue and bubbly, 7+ — on fire, 30+ — full disco.
 * Within a tier the effects keep ramping (streakLevel): 10+/20+ add licking
 * flames and an inferno glow; 40+ doubles the lasers, and at 50+ the disco
 * escapes the card entirely (see <DiscoRays /> rendered by Layout).
 */
export default function StreakCard({ streak }: { streak: StreakInfo }) {
  const t = useT();
  const tier = streakTier(streak.current);
  const level = streakLevel(streak.current);
  const lit = tier !== "plain";

  const sub = streak.atRisk
    ? t("map.streak.at_risk")
    : streak.onBuoy
      ? t("map.streak.protected")
      : undefined;

  return (
    <m.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 280, damping: 24 }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        "relative h-full",
        // 20+: pulsing inferno glow. Lives on the wrapper — the card itself is
        // overflow-hidden, which would clip an animated box-shadow.
        tier === "fire" &&
          level >= 3 &&
          "animate-fire-pulse rounded-2xl motion-reduce:animate-none",
      )}
    >
      {/* Rendered before (= painted under) the card so only the tips escape
          past the top edge — the card is overflow-hidden, so flames that
          should leave the box can't live inside it. The strip overlaps the
          card top by a few px, hiding the flame roots behind it. */}
      {tier === "fire" && level >= 2 ? (
        <PixiLayer
          build={edgeFireFx}
          options={{ level }}
          className="inset-x-1 -top-7 bottom-auto h-9"
        />
      ) : null}
      <Link
        to="/streak"
        // The tier gradients animate via animate-disco-shift; higher levels
        // just crank the tempo (inline — a second animate-* class would
        // overwrite the animation shorthand).
        style={
          (tier === "fire" && level >= 2) || (tier === "disco" && level >= 2)
            ? { animationDuration: tier === "fire" ? "2.5s" : "3s" }
            : undefined
        }
        className={cn(
          "relative flex h-full flex-col items-start gap-1 overflow-hidden px-3 py-2.5",
          tier === "plain" && "glass",
          tier === "bubbly" &&
            "rounded-2xl border border-white/40 bg-gradient-to-br from-wave-400 to-wave-600 shadow-[0_10px_30px_-10px_rgba(1,158,234,0.6)]",
          tier === "fire" &&
            "rounded-2xl border border-orange-200/60 shadow-[0_10px_30px_-8px_rgba(249,115,22,0.7)]",
          tier === "fire" &&
            level === 1 &&
            "bg-gradient-to-br from-amber-400 via-orange-500 to-red-500",
          // 10+: the gradient itself churns like a living fire.
          tier === "fire" &&
            level >= 2 &&
            "animate-disco-shift bg-[linear-gradient(115deg,#fbbf24,#f97316,#dc2626,#991b1b,#f97316,#fbbf24)] bg-[length:300%_300%]",
          tier === "disco" &&
            "animate-disco-shift rounded-2xl border border-white/40 bg-[linear-gradient(115deg,#ff0080,#7928ca,#00b4ff,#2af598,#ffd200,#ff0080)] bg-[length:400%_400%] shadow-[0_10px_30px_-8px_rgba(121,40,202,0.7)]",
        )}
      >
        {tier === "bubbly" ? <PixiLayer build={bubblesFx} /> : null}
        {tier === "fire" ? (
          <PixiLayer build={fireFx} options={{ level }} />
        ) : null}
        {tier === "disco" ? (
          <PixiLayer build={discoFx} options={{ level }} />
        ) : null}

        <div
          className={cn(
            "relative z-10 flex items-center gap-1 text-[10px] font-semibold tracking-wide uppercase",
            lit
              ? "text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.35)]"
              : "text-wave-700",
          )}
        >
          {tier === "disco" ? (
            <span className="animate-bob motion-reduce:animate-none">🪩</span>
          ) : (
            <Flame
              className={cn(
                "h-4 w-4",
                tier === "fire" &&
                  "animate-flame-flicker text-yellow-200 motion-reduce:animate-none",
              )}
            />
          )}
          {t("map.stat.streak")}
        </div>
        <AnimatedNumber
          value={streak.current}
          className={cn(
            "relative z-10 font-display text-2xl font-black",
            lit
              ? "text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.25)]"
              : "text-wave-900",
          )}
        />
        {sub ? (
          <div
            className={cn(
              "relative z-10 text-[10px]",
              lit
                ? "text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.35)]"
                : "text-amber-700",
            )}
          >
            {sub}
          </div>
        ) : null}
      </Link>
    </m.div>
  );
}
