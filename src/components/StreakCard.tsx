import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Flame } from "lucide-react";
import { useT } from "@/lib/i18n";
import { streakTier, type StreakInfo } from "@/lib/streak";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { cn } from "@/lib/utils";

/**
 * The front-page streak stat card. Escalates with the streak:
 * 3+ days — blue and bubbly, 7+ — on fire, 30+ — full disco.
 */
export default function StreakCard({ streak }: { streak: StreakInfo }) {
  const t = useT();
  const tier = streakTier(streak.current);
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
      className="h-full"
    >
      <Link
        to="/streak"
        className={cn(
          "relative flex h-full flex-col items-start gap-1 overflow-hidden px-3 py-2.5",
          tier === "plain" && "glass",
          tier === "bubbly" &&
            "rounded-2xl border border-white/40 bg-gradient-to-br from-wave-400 to-wave-600 shadow-[0_10px_30px_-10px_rgba(1,158,234,0.6)]",
          tier === "fire" &&
            "rounded-2xl border border-orange-200/60 bg-gradient-to-br from-amber-400 via-orange-500 to-red-500 shadow-[0_10px_30px_-8px_rgba(249,115,22,0.7)]",
          tier === "disco" &&
            "animate-disco-shift rounded-2xl border border-white/40 bg-[linear-gradient(115deg,#ff0080,#7928ca,#00b4ff,#2af598,#ffd200,#ff0080)] bg-[length:400%_400%] shadow-[0_10px_30px_-8px_rgba(121,40,202,0.7)]",
        )}
      >
        {tier === "bubbly" ? <Bubbles /> : null}
        {tier === "fire" ? <Embers /> : null}
        {tier === "disco" ? <Lasers /> : null}

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

const EMBERS = [
  { left: "15%", size: 4, duration: 1.4, delay: 0 },
  { left: "35%", size: 3, duration: 1.9, delay: 0.6 },
  { left: "58%", size: 5, duration: 1.6, delay: 0.3 },
  { left: "76%", size: 3, duration: 2.1, delay: 1.0 },
  { left: "90%", size: 4, duration: 1.7, delay: 0.8 },
];

function Embers() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 motion-reduce:hidden"
    >
      {EMBERS.map((e, i) => (
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

function Lasers() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 motion-reduce:hidden"
    >
      {/* Beams sweep around the centre like a club light rig. */}
      <div className="absolute top-1/2 left-1/2 h-[300%] w-[300%] -translate-x-1/2 -translate-y-1/2 animate-laser-spin">
        <span className="absolute top-1/2 left-0 h-px w-full bg-gradient-to-r from-transparent via-white/80 to-transparent" />
        <span className="absolute top-1/2 left-0 h-px w-full rotate-60 bg-gradient-to-r from-transparent via-cyan-200/80 to-transparent" />
        <span className="absolute top-1/2 left-0 h-px w-full rotate-120 bg-gradient-to-r from-transparent via-fuchsia-200/80 to-transparent" />
      </div>
      <span className="absolute top-1 right-2 animate-bob text-[10px]">✨</span>
      <span
        className="absolute right-6 bottom-1 animate-bob text-[9px]"
        style={{ animationDelay: "1.2s" }}
      >
        ✨
      </span>
    </div>
  );
}
