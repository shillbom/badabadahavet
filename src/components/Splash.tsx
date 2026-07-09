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
// The image is normally already loaded (and SW-precached) by the time React
// renders this, so the `complete` check in the ref reveals it without a fade;
// onLoad handles the cold-cache case with the same crossfade as the HTML
// splash (a ~1 KB blurred inline preview shows underneath until then).
const reveal = (el: HTMLImageElement | null) => {
  if (el?.complete) el.classList.add("app-splash__bg--loaded");
};

export function FullSplash() {
  return (
    <div className="app-splash">
      <img
        className="app-splash__bg"
        src="/splash.webp"
        alt=""
        ref={reveal}
        onLoad={(e) => e.currentTarget.classList.add("app-splash__bg--loaded")}
      />
      <div className="app-splash__ripples" aria-hidden="true">
        <span className="app-splash__ripple" />
        <span className="app-splash__ripple" />
        <span className="app-splash__ripple" />
      </div>
      <div className="app-splash__word">Badligan</div>
    </div>
  );
}
