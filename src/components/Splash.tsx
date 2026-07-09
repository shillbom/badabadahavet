/**
 * Full-screen boot/loading splash (resting scene).
 *
 * Pure CSS (no image, no framer-motion) so this component stays out of the
 * first-paint critical path — it's the Suspense fallback shown while a lazy
 * route chunk loads, and pulling in framer-motion here would force that
 * ~126 KB chunk to download before anything could render.
 *
 * The initial boot splash is NOT this component: it's a sibling overlay baked
 * into index.html that plays the entrance and animates itself out once the app
 * is ready (see the splash controller there). This React copy mirrors that
 * overlay's markup/classes for the resting scene so in-app route loads look
 * identical — keep the two in sync. The styles live in index.html's inline
 * <style>.
 */
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

export function FullSplash() {
  return (
    <div className="app-splash">
      <SplashArt />
    </div>
  );
}
