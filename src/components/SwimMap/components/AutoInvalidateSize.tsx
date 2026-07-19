import { useEffect } from "react";
import { useMap } from "react-leaflet";

/**
 * Keeps Leaflet's cached viewport size in sync with the actual container.
 */
export default function AutoInvalidateSize() {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    let raf = 0;
    const invalidate = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => map.invalidateSize({ animate: false }));
    };
    invalidate();
    const ro = new ResizeObserver(invalidate);
    ro.observe(container);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [map]);
  return null;
}
