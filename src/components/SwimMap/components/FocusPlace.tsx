import { useEffect } from "react";
import { useMap } from "react-leaflet";
import type L from "leaflet";
import type { RefObject } from "react";

/**
 * Pans to a place when `target` changes and opens its popup. The focused
 * place always renders outside the cluster group, so it's a plain
 * flyTo + openPopup; a short delay lets a freshly-mounted marker register.
 */
export default function FocusPlace({
  target,
  markerRefs,
}: {
  target: { lat: number; lng: number; id: string; token: number } | null;
  markerRefs: RefObject<Map<string, L.Marker>>;
}) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    let moveHandler: (() => void) | null = null;
    const timer = window.setTimeout(() => {
      map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 13), {
        animate: true,
      });
      moveHandler = () => {
        if (moveHandler) map.off("moveend", moveHandler);
        markerRefs.current.get(target.id)?.openPopup();
      };
      map.on("moveend", moveHandler);
    }, 150);
    return () => {
      window.clearTimeout(timer);
      if (moveHandler) map.off("moveend", moveHandler);
    };
  }, [map, target, markerRefs]);
  return null;
}
