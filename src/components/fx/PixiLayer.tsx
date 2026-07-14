import { useEffect, useRef } from "react";
import type { Application } from "pixi.js";
import { cn } from "@/lib/utils";

/**
 * A transparent PixiJS canvas layered over (or inside) a DOM element, used
 * for the custom-drawn 2D effects (streak card tiers, celebration bursts).
 *
 * pixi.js (~large) is loaded lazily on first mount so it stays out of the
 * entry chunk — the map page, where the streak card lives, is first-paint
 * sensitive. Until the import resolves the layer is simply empty.
 *
 * Builders draw their scene once and animate transforms on the ticker
 * (PixiJS tessellates Graphics geometry — rebuilding it per frame is the
 * expensive path). A builder may return a cleanup fn; the Application
 * itself is fully destroyed on unmount either way.
 */

export type PixiFx = (
  PIXI: typeof import("pixi.js"),
  app: Application,
  options: Record<string, string | number>,
) => void | (() => void);

let pixiMod: Promise<typeof import("pixi.js")> | undefined;
const loadPixi = () => (pixiMod ??= import("pixi.js"));

export const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function PixiLayer({
  build,
  options,
  maxFPS = 40,
  className,
}: {
  build: PixiFx;
  options?: Record<string, string | number>;
  /** Ambient card effects don't need 60 fps; cap saves battery. */
  maxFPS?: number;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Builders are module-level functions, so the effect keys on the options
  // *values* — a stable serialized form avoids re-init on every render.
  const optionsKey = JSON.stringify(options ?? {});

  useEffect(() => {
    const host = hostRef.current;
    if (!host || prefersReducedMotion()) return;
    let disposed = false;
    let app: Application | null = null;
    let cleanup: (() => void) | void;

    void loadPixi().then(async (PIXI) => {
      if (disposed) return;
      const a = new PIXI.Application();
      await a.init({
        backgroundAlpha: 0,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
        resizeTo: host,
        powerPreference: "low-power",
        // Pure output layer — never intercepts input.
        eventFeatures: { move: false, click: false, wheel: false },
      });
      // Unmounted while init was in flight — tear straight back down.
      if (disposed) {
        a.destroy(
          { removeView: true },
          { children: true, texture: true, textureSource: true },
        );
        return;
      }
      app = a;
      a.ticker.maxFPS = maxFPS;
      a.canvas.classList.add("absolute", "inset-0", "h-full", "w-full");
      host.appendChild(a.canvas);
      cleanup = build(PIXI, a, JSON.parse(optionsKey));
      return;
    });

    return () => {
      disposed = true;
      cleanup?.();
      app?.destroy(
        { removeView: true },
        { children: true, texture: true, textureSource: true },
      );
      app = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- optionsKey stands in for options
  }, [build, optionsKey, maxFPS]);

  return (
    <div
      ref={hostRef}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden",
        className,
      )}
    />
  );
}
