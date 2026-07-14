import { useStore } from "@/store/sessions";
import { streakLevel, streakTier } from "@/lib/streak";

/* Two counter-rotating ray fans, built as repeating conic gradients whose
   periods divide 360° so the loop is seamless. Alpha lives in the colour
   stops (~0.1) — the app stays fully readable underneath. */
const RAYS_FRONT =
  "repeating-conic-gradient(from 0deg, transparent 0deg 18deg, rgba(255,0,128,0.11) 18deg 24deg, transparent 24deg 42deg, rgba(0,180,255,0.11) 42deg 48deg, transparent 48deg 66deg, rgba(255,210,0,0.11) 66deg 72deg)";
const RAYS_BACK =
  "repeating-conic-gradient(from 9deg, transparent 0deg 24deg, rgba(42,245,152,0.09) 24deg 30deg, transparent 30deg 60deg, rgba(121,40,202,0.09) 60deg 66deg, transparent 66deg 90deg)";

const SPARKLES = [
  { className: "top-24 left-4 text-sm", delay: 0 },
  { className: "top-40 right-6 text-xs", delay: 0.9 },
  { className: "bottom-40 left-8 text-xs", delay: 1.6 },
  { className: "right-4 bottom-28 text-sm", delay: 0.4 },
];

/**
 * The 50+ day mega-disco: a mirror ball drops from the header and its rays
 * sweep the entire app. Rendered once by Layout above all chrome, but
 * pointer-events-none end to end — everything underneath stays usable.
 * Gates itself on the viewer's own streak, so it costs nothing otherwise.
 */
export default function DiscoRays() {
  const current = useStore((s) => s.myStats.streak.current);
  if (streakTier(current) !== "disco" || streakLevel(current) < 3) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 bottom-0 z-[1020] mx-auto max-w-md overflow-hidden motion-reduce:hidden"
    >
      {/* Ray fans centred on the mirror ball. 250vmax so the swept disc
          covers every corner of the tallest phone viewport. */}
      <div
        className="absolute top-16 left-1/2 h-[250vmax] w-[250vmax] -translate-x-1/2 -translate-y-1/2 animate-laser-spin"
        style={{ background: RAYS_BACK, animationDuration: "26s" }}
      />
      <div
        className="absolute top-16 left-1/2 h-[250vmax] w-[250vmax] -translate-x-1/2 -translate-y-1/2 animate-laser-spin"
        style={{
          background: RAYS_FRONT,
          animationDuration: "18s",
          animationDirection: "reverse",
        }}
      />
      {/* The ball itself, hanging from the top of the app. */}
      <span className="absolute top-0 left-1/2 h-14 w-px bg-slate-400/40" />
      <span className="absolute top-11 left-1/2 -translate-x-1/2 animate-bob text-3xl drop-shadow-lg">
        🪩
      </span>
      {SPARKLES.map((s) => (
        <span
          key={s.className}
          className={`absolute animate-bob ${s.className}`}
          style={{ animationDelay: `${s.delay}s` }}
        >
          ✨
        </span>
      ))}
    </div>
  );
}
