/**
 * Full-screen boot/loading splash.
 *
 * Pure CSS (no image, no framer-motion) so this component stays out of the
 * first-paint critical path — it's the Suspense fallback rendered before the
 * app chunk loads, and pulling in framer-motion here would force that ~126 KB
 * chunk to download before anything could render.
 *
 * The markup + class names mirror the static splash baked into index.html so
 * the handoff from the HTML splash to this React one is seamless. The entrance
 * (waves sweeping in, wordmark sliding up its baseline) is played once by the
 * HTML splash via the `--intro` modifier; these React renders show the resting
 * scene so the motion doesn't restart on takeover. Keep in sync with
 * index.html; the styles live there in the inline <style>.
 */
import { useEffect, useState } from "react";

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

/** Static splash — the resting scene, used as the Suspense fallback. */
export function FullSplash() {
  return (
    <div className="app-splash">
      <SplashArt />
    </div>
  );
}

/**
 * Boot overlay. Sits on top of the app while it boots, then animates away to
 * reveal it once `booting` flips false — the splash fades as the water drains
 * back down the diagonal and the wordmark flies off up its baseline. It then
 * unmounts (phase `gone`) so it never re-appears mid-session.
 */
export function SplashScreen({ booting }: { booting: boolean }) {
  const [phase, setPhase] = useState<"idle" | "leaving" | "gone">("idle");

  useEffect(() => {
    if (!booting) setPhase((p) => (p === "idle" ? "leaving" : p));
  }, [booting]);

  if (phase === "gone") return null;

  return (
    <div
      className={
        "app-splash" + (phase === "leaving" ? " app-splash--leaving" : "")
      }
      // The root's own fade-out (app-splash-out) is the last thing to end;
      // the child water/word animations bubble here too, so ignore those.
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
