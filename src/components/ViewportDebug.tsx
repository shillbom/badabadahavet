import { useEffect, useState } from "react";

/**
 * Admin-only live readout of every viewport measurement iOS gives us —
 * a diagnostic for the iOS 26 standalone letterboxing (status-bar band +
 * gap under the nav). Numbers straight from the device beat guessing:
 * screen vs. innerHeight tells us how much iOS insets the layout
 * viewport, and the safe-area probes tell us whether env() sees it.
 * Temporary by nature; remove once the PWA renders edge-to-edge.
 */
export default function ViewportDebug() {
  const [vals, setVals] = useState<Record<string, string>>({});

  useEffect(() => {
    // env() can't be read directly from JS — measure a probe element
    // padded by the insets.
    const probe = document.createElement("div");
    probe.style.cssText =
      "position:fixed;visibility:hidden;pointer-events:none;" +
      "padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)";
    document.body.appendChild(probe);

    const measure = () => {
      const cs = getComputedStyle(probe);
      setVals({
        "screen.height": `${screen.height}`,
        "window.innerHeight": `${window.innerHeight}`,
        "window.outerHeight": `${window.outerHeight}`,
        "html.clientHeight": `${document.documentElement.clientHeight}`,
        "visualViewport.height": `${Math.round(window.visualViewport?.height ?? -1)}`,
        "visualViewport.offsetTop": `${Math.round(window.visualViewport?.offsetTop ?? -1)}`,
        "safe-area-inset-top": cs.paddingTop,
        "safe-area-inset-bottom": cs.paddingBottom,
        "--app-height":
          document.documentElement.style.getPropertyValue("--app-height"),
        "display-mode": window.matchMedia("(display-mode: standalone)").matches
          ? "standalone"
          : window.matchMedia("(display-mode: fullscreen)").matches
            ? "fullscreen"
            : "browser",
        "color-scheme": window.matchMedia("(prefers-color-scheme: dark)")
          .matches
          ? "dark"
          : "light",
      });
    };
    measure();
    const timer = setInterval(measure, 1000);
    return () => {
      clearInterval(timer);
      probe.remove();
    };
  }, []);

  return (
    <div className="mt-6 rounded-2xl bg-slate-900 p-4 font-mono text-[11px] leading-5 text-emerald-300">
      <div className="mb-1 font-bold text-white">viewport debug</div>
      {Object.entries(vals).map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4">
          <span className="text-slate-400">{k}</span>
          <span>{v || "—"}</span>
        </div>
      ))}
    </div>
  );
}
