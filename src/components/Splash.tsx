/**
 * Boot / loading splash.
 *
 * Pure CSS (no image, no framer-motion, no Pixi) on purpose: <BootSplash> is
 * mounted eagerly in main.tsx so it can paint before the lazy <App> (and its
 * ~618 KB Firebase chunk) loads. Pulling an animation lib in here would drag
 * that chunk onto the first-paint critical path — the very thing the app's
 * lazy boundaries exist to avoid. CSS animates it for free. Styles live in
 * src/index.css (`.app-splash*`).
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { getBootReady, subscribeBootReady } from "@/lib/bootSignal";

function SplashArt() {
  return (
    <div className="app-splash__panel">
      <div className="app-splash__waves" aria-hidden="true">
        <div className="app-splash__water">
          <span className="app-splash__wave" />
          <span className="app-splash__wave" />
          <span className="app-splash__wave" />
          <span className="app-splash__wave" />
          <span className="app-splash__wave" />
          <span className="app-splash__wave" />
        </div>
      </div>
      {/* "Liquid type" wordmark: a ghost of the word with a second copy filled
          by a travelling-wave <pattern>, so the letters read as half-full of
          water. SMIL keeps it dependency-free (see file header). Two splashes
          can briefly coexist (BootSplash over the Suspense FullSplash); the
          duplicated SVG ids are benign because the defs are identical. */}
      <div className="app-splash__word" role="img" aria-label="Badligan">
        <svg viewBox="0 0 240 68" aria-hidden="true">
          <defs>
            <linearGradient id="splash-liquid" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#019eea" />
              <stop offset="1" stopColor="#0264a0" />
            </linearGradient>
            <pattern
              id="splash-wave"
              x="0"
              y="0"
              width="100%"
              height="100%"
              patternUnits="userSpaceOnUse"
            >
              {/* Wavelength 40; one loop translates exactly one wavelength so
                  the crests scroll seamlessly. The extra -80 of path keeps the
                  left edge covered at full translation. */}
              <path
                d="M-80 32 Q-70 28.5 -60 32 T-40 32 T-20 32 T0 32 T20 32 T40 32 T60 32 T80 32 T100 32 T120 32 T140 32 T160 32 T180 32 T200 32 T220 32 T240 32 T260 32 V68 H-80 Z"
                fill="url(#splash-liquid)"
              >
                <animateTransform
                  attributeName="transform"
                  type="translate"
                  from="0,0"
                  to="40,0"
                  dur="2.6s"
                  repeatCount="indefinite"
                />
              </path>
            </pattern>
          </defs>
          <text
            className="app-splash__word-ghost"
            textAnchor="middle"
            x="120"
            y="50"
            fontSize="64"
          >
            Badligan
          </text>
          <text
            className="app-splash__word-liquid"
            textAnchor="middle"
            x="120"
            y="50"
            fontSize="64"
            fill="url(#splash-wave)"
          >
            Badligan
          </text>
        </svg>
      </div>
    </div>
  );
}

/** Static resting splash — the Suspense fallback for in-app lazy route loads. */
export function FullSplash() {
  return (
    <div className="app-splash">
      <SplashArt />
    </div>
  );
}

// Guarantee the entrance is actually seen even when boot is instant (warm
// cache / already signed in) before letting the exit start.
const MIN_VISIBLE_MS = 1100;

/**
 * The boot splash. Mounts at first paint (main.tsx, outside the lazy <App>),
 * plays the entrance, and once App signals ready (bootSignal) it plays the
 * exit and unmounts — revealing the app underneath.
 */
export function BootSplash() {
  const ready = useSyncExternalStore(subscribeBootReady, getBootReady);
  const [phase, setPhase] = useState<"intro" | "leaving" | "gone">("intro");
  const [startedAt] = useState(Date.now);

  useEffect(() => {
    if (!ready) return;
    const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - startedAt));
    const timer = window.setTimeout(
      () => setPhase((p) => (p === "intro" ? "leaving" : p)),
      wait,
    );
    return () => window.clearTimeout(timer);
  }, [ready, startedAt]);

  if (phase === "gone") return null;

  return (
    <div
      className={`app-splash app-splash--${phase}`}
      // Only the root's own fade-out (app-splash-out) unmounts us; the child
      // water/word animations bubble their animationend here too, so ignore
      // anything that isn't the root element.
      onAnimationEnd={(e) => {
        if (phase === "leaving" && e.target === e.currentTarget) {
          setPhase("gone");
        }
      }}
    >
      <SplashArt />
    </div>
  );
}
