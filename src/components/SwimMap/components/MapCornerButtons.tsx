import { LocateFixed, Maximize, Minimize } from "lucide-react";
import type L from "leaflet";
import type { RefObject } from "react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

/**
 * Bottom-right round buttons (Google Maps style): the fullscreen toggle
 * stacked above "locate me".
 */
export default function MapCornerButtons({
  fullscreenControl,
  fullscreen,
  toggleFullscreen,
  userLocation,
  mapRef,
}: {
  fullscreenControl?: boolean;
  fullscreen: boolean;
  toggleFullscreen: () => void;
  userLocation?: { lat: number; lng: number } | null;
  mapRef: RefObject<L.Map | null>;
}) {
  const t = useT();
  return (
    <div
      className={cn(
        "absolute right-3 z-[600] flex flex-col gap-2",
        fullscreen
          ? "bottom-[max(env(safe-area-inset-bottom),1.25rem)]"
          : "bottom-5",
      )}
    >
      {fullscreenControl ? (
        <button
          type="button"
          onClick={toggleFullscreen}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-wave-700 shadow-md ring-1 ring-slate-200 transition hover:bg-white active:scale-95"
          aria-label={
            fullscreen ? t("map.exit_fullscreen") : t("map.fullscreen")
          }
          title={fullscreen ? t("map.exit_fullscreen") : t("map.fullscreen")}
        >
          {fullscreen ? (
            <Minimize className="h-5 w-5" />
          ) : (
            <Maximize className="h-5 w-5" />
          )}
        </button>
      ) : null}
      {userLocation ? (
        <button
          type="button"
          onClick={() => {
            const map = mapRef.current;
            if (map)
              map.setView([userLocation.lat, userLocation.lng], 13, {
                animate: true,
              });
          }}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-wave-700 shadow-md ring-1 ring-slate-200 transition hover:bg-white active:scale-95"
          aria-label={t("map.center_on_me")}
          title={t("map.center_on_me")}
        >
          <LocateFixed className="h-5 w-5" />
        </button>
      ) : null}
    </div>
  );
}
