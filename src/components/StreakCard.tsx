import { motion } from "framer-motion";
import { Link } from "react-router";
import { Flame } from "lucide-react";
import { useT } from "@/lib/i18n";
import { streakLevel, streakTier, type StreakInfo } from "@/lib/streak";
import { AnimatedNumber } from "@/components/AnimatedNumber";
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
    <motion.div
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
          should leave the box can't live inside it. */}
      {tier === "fire" && level >= 2 ? <EdgeFlames level={level} /> : null}
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
        {tier === "bubbly" ? <Bubbles /> : null}
        {tier === "fire" ? <Embers level={level} /> : null}
        {tier === "fire" && level >= 2 ? <Flames level={level} /> : null}
        {tier === "disco" ? <Lasers level={level} /> : null}

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
    </motion.div>
  );
}

const BUBBLES = [
  { left: "12%", size: 10, duration: 2.6, delay: 0 },
  { left: "32%", size: 6, duration: 3.4, delay: 1.1 },
  { left: "55%", size: 12, duration: 2.9, delay: 0.5 },
  { left: "72%", size: 7, duration: 3.8, delay: 1.7 },
  { left: "88%", size: 9, duration: 3.1, delay: 0.9 },
];

function Bubbles() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 motion-reduce:hidden"
    >
      {BUBBLES.map((b, i) => (
        <span
          key={i}
          className="absolute bottom-0 animate-bubble-rise rounded-full border border-white/60 bg-white/30"
          style={{
            left: b.left,
            width: b.size,
            height: b.size,
            animationDuration: `${b.duration}s`,
            animationDelay: `${b.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

// Ordered so slicing the first 5/9/14 keeps an even spread at every level.
const EMBERS = [
  { left: "15%", size: 4, duration: 1.4, delay: 0 },
  { left: "35%", size: 3, duration: 1.9, delay: 0.6 },
  { left: "58%", size: 5, duration: 1.6, delay: 0.3 },
  { left: "76%", size: 3, duration: 2.1, delay: 1.0 },
  { left: "90%", size: 4, duration: 1.7, delay: 0.8 },
  { left: "8%", size: 3, duration: 1.5, delay: 1.2 },
  { left: "26%", size: 5, duration: 1.8, delay: 0.4 },
  { left: "48%", size: 3, duration: 1.3, delay: 0.9 },
  { left: "67%", size: 4, duration: 2.0, delay: 0.1 },
  { left: "84%", size: 5, duration: 1.5, delay: 1.4 },
  { left: "20%", size: 3, duration: 1.2, delay: 0.7 },
  { left: "42%", size: 4, duration: 1.7, delay: 1.1 },
  { left: "62%", size: 3, duration: 1.4, delay: 0.5 },
  { left: "95%", size: 3, duration: 1.9, delay: 0.2 },
];

function Embers({ level }: { level: number }) {
  const embers = EMBERS.slice(0, level >= 3 ? 14 : level === 2 ? 9 : 5);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 motion-reduce:hidden"
    >
      {embers.map((e, i) => (
        <span
          key={i}
          className="absolute bottom-0 animate-ember-rise rounded-full bg-yellow-200 shadow-[0_0_6px_2px_rgba(253,224,71,0.8)]"
          style={{
            left: e.left,
            width: e.size,
            height: e.size,
            animationDuration: `${e.duration}s`,
            animationDelay: `${e.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

// Two layers of blurred blobs read as fire: wide orange tongues at the back,
// narrow yellow cores in front. Slicing keeps the spread even (like EMBERS).
const FLAMES = [
  { left: "-4%", w: 24, h: 46, duration: 0.8, delay: 0, core: false },
  { left: "16%", w: 20, h: 38, duration: 0.65, delay: 0.25, core: false },
  { left: "38%", w: 26, h: 52, duration: 0.75, delay: 0.1, core: false },
  { left: "60%", w: 20, h: 42, duration: 0.7, delay: 0.35, core: false },
  { left: "82%", w: 24, h: 48, duration: 0.85, delay: 0.2, core: false },
  { left: "4%", w: 11, h: 32, duration: 0.6, delay: 0.15, core: true },
  { left: "28%", w: 12, h: 36, duration: 0.7, delay: 0.4, core: true },
  { left: "50%", w: 13, h: 34, duration: 0.6, delay: 0.05, core: true },
  { left: "72%", w: 12, h: 38, duration: 0.75, delay: 0.3, core: true },
  { left: "92%", w: 10, h: 28, duration: 0.65, delay: 0.45, core: true },
];

/** Overwatch-style "on fire" — flames licking up from the bottom edge.
 *  Level 2 keeps them low; level 3 turns the lower half into an inferno. */
function Flames({ level }: { level: number }) {
  const scale = level >= 3 ? 1.7 : 1;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 motion-reduce:hidden"
    >
      {FLAMES.map((f, i) => (
        <span
          key={i}
          className={cn(
            "absolute -bottom-2 origin-bottom animate-flame-lick rounded-full blur-[4px]",
            f.core
              ? "bg-gradient-to-t from-yellow-300 via-amber-300/90 to-transparent"
              : "bg-gradient-to-t from-red-500/90 via-orange-400/80 to-transparent",
          )}
          style={{
            left: f.left,
            width: f.w * (f.core ? 1 : scale),
            height: f.h * scale,
            animationDuration: `${f.duration}s`,
            animationDelay: `${f.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

// Tongues that escape past the card's top edge. Bases sit a few px inside
// the card (which paints on top and hides them) so only the tips show.
const EDGE_FLAMES = [
  { left: "6%", w: 14, h: 26, duration: 0.75, delay: 0.1, core: false },
  { left: "30%", w: 16, h: 30, duration: 0.65, delay: 0.3, core: false },
  { left: "56%", w: 14, h: 24, duration: 0.8, delay: 0, core: false },
  { left: "80%", w: 16, h: 28, duration: 0.7, delay: 0.2, core: false },
  { left: "16%", w: 8, h: 20, duration: 0.6, delay: 0.4, core: true },
  { left: "44%", w: 9, h: 22, duration: 0.7, delay: 0.15, core: true },
  { left: "68%", w: 8, h: 18, duration: 0.6, delay: 0.35, core: true },
  { left: "90%", w: 8, h: 20, duration: 0.75, delay: 0.05, core: true },
];

/** 10+: the fire spills out of the box — flames lick up past the card's top
 *  edge from behind it. Level 3 sends them higher and adds every tongue. */
function EdgeFlames({ level }: { level: number }) {
  const flames = EDGE_FLAMES.slice(0, level >= 3 ? 8 : 4);
  const scale = level >= 3 ? 1.5 : 1;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 motion-reduce:hidden"
    >
      {flames.map((f, i) => (
        <span
          key={i}
          className={cn(
            "absolute origin-bottom animate-flame-lick rounded-full blur-[3px]",
            f.core
              ? "bg-gradient-to-t from-amber-300 via-yellow-200/90 to-transparent"
              : "bg-gradient-to-t from-orange-500 via-orange-400/90 to-transparent",
          )}
          style={{
            left: f.left,
            width: f.w,
            height: f.h * scale,
            top: -f.h * scale + 8,
            animationDuration: `${f.duration}s`,
            animationDelay: `${f.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

const SPARKLES = [
  { className: "top-1 right-2 text-[10px]", delay: 0 },
  { className: "right-6 bottom-1 text-[9px]", delay: 1.2 },
  { className: "top-2 left-3 text-[9px]", delay: 0.6 },
  { className: "bottom-2 left-8 text-[10px]", delay: 1.8 },
];

const BEAMS = [
  { rotate: "rotate-0", color: "via-white/80" },
  { rotate: "rotate-60", color: "via-cyan-200/80" },
  { rotate: "rotate-120", color: "via-fuchsia-200/80" },
  { rotate: "rotate-30", color: "via-yellow-200/80" },
  { rotate: "rotate-90", color: "via-emerald-200/80" },
  { rotate: "rotate-150", color: "via-rose-200/80" },
];

/** Club light rig. 40+ doubles the beams, spins them faster and adds
 *  sparkles; at 50+ the same rig also goes app-wide (see DiscoRays). */
function Lasers({ level }: { level: number }) {
  const beams = BEAMS.slice(0, level >= 2 ? 6 : 3);
  const sparkles = SPARKLES.slice(0, level >= 2 ? 4 : 2);
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 motion-reduce:hidden"
    >
      {/* Beams sweep around the centre like a club light rig. */}
      <div
        className="absolute top-1/2 left-1/2 h-[300%] w-[300%] -translate-x-1/2 -translate-y-1/2 animate-laser-spin"
        style={level >= 2 ? { animationDuration: "2.5s" } : undefined}
      >
        {beams.map((b, i) => (
          <span
            key={i}
            className={cn(
              "absolute top-1/2 left-0 h-px w-full bg-gradient-to-r from-transparent to-transparent",
              b.rotate,
              b.color,
            )}
          />
        ))}
      </div>
      {sparkles.map((s, i) => (
        <span
          key={i}
          className={cn("absolute animate-bob", s.className)}
          style={{ animationDelay: `${s.delay}s` }}
        >
          ✨
        </span>
      ))}
    </div>
  );
}
