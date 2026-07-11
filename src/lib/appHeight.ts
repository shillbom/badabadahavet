/**
 * iOS standalone PWAs can launch with a webview smaller than the screen
 * (letterboxed under the status bar / above the home indicator) and — since
 * the app shell never scrolls — never receive the relayout that snaps it to
 * full size. Viewport units repeat the lie, so CSS alone can't fix it: we
 * measure the real height in JS and expose it as `--app-height`, which the
 * shell and full-height pages prefer over 100dvh (their fallback).
 *
 * The window.scrollTo(0, 0) nudge is deliberate: a scroll event is what
 * forces WebKit to recompute the stuck launch viewport (users previously
 * "fixed" the layout by scrolling). The delayed re-measures catch the
 * expansion when the resize event for it is late or missing.
 */
export function installAppHeight() {
  const root = document.documentElement;
  const measure = () => {
    // innerHeight (layout viewport) on purpose, NOT visualViewport.height:
    // the visual viewport shrinks for the on-screen keyboard, and squeezing
    // the whole shell every time a text field focuses would jank the UI.
    const h = Math.round(window.innerHeight);
    if (h > 0) root.style.setProperty("--app-height", `${h}px`);
  };
  const nudgeAndMeasure = () => {
    window.scrollTo(0, 0);
    measure();
    setTimeout(measure, 250);
    setTimeout(measure, 1000);
  };

  window.addEventListener("resize", measure);
  window.addEventListener("orientationchange", measure);
  // Relaunch from the home screen / back-forward cache restore.
  window.addEventListener("pageshow", nudgeAndMeasure);
  nudgeAndMeasure();
}
