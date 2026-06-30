/**
 * Full-screen boot/loading splash.
 *
 * Pure CSS animations (no framer-motion) so this component stays out of the
 * first-paint critical path — it's the Suspense fallback rendered before the
 * app chunk loads, and pulling in framer-motion here would force that ~126 KB
 * chunk to download before anything could render.
 *
 * The markup + class names mirror the static splash baked into index.html so
 * the handoff from the HTML splash to this React one is seamless. Keep them in
 * sync; the styles live in index.html's inline <style>.
 */
export function FullSplash() {
  return (
    <div className="app-splash">
      <div className="app-splash__logo">
        <span className="app-splash__ripple" />
        <span className="app-splash__ripple" />
        <span className="app-splash__ripple" />
        <img
          className="app-splash__img"
          src="/web-app-manifest-192x192.png"
          alt="Badligan"
        />
      </div>
      <div className="app-splash__word">Badligan</div>
    </div>
  );
}
