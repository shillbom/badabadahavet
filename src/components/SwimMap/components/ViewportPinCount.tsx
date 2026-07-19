import { useEffect } from "react";
import { useMap } from "react-leaflet";
import { useEffectEvent } from "react";
import type { PlaceWithTemp } from "@/lib/types";

/**
 * Reports how many of `places` fall within the current viewport, on mount and
 * after every pan/zoom. Lets the map decide whether clustering is worthwhile
 * for what's actually on screen. `onCount` must be referentially stable.
 */
export default function ViewportPinCount({
  places,
  onCount,
}: {
  places: PlaceWithTemp[];
  onCount: (n: number) => void;
}) {
  const map = useMap();
  const reportCount = useEffectEvent(onCount);
  useEffect(() => {
    const measure = () => {
      const bounds = map.getBounds();
      let n = 0;
      for (const p of places) if (bounds.contains([p.lat, p.lng])) n++;
      reportCount(n);
    };
    measure();
    map.on("moveend zoomend", measure);
    return () => {
      map.off("moveend zoomend", measure);
    };
  }, [map, places]);
  return null;
}
