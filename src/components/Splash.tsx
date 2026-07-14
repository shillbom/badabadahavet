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
      <div className="app-splash__word">Badligan</div>
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
