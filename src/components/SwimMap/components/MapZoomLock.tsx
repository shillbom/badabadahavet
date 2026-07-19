import { useEffect } from "react";
import { useMap } from "react-leaflet";

/** Disables / re-enables all zoom interactions reactively. */
export default function MapZoomLock({ locked }: { locked: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (locked) {
      map.scrollWheelZoom.disable();
      map.touchZoom.disable();
      map.doubleClickZoom.disable();
      map.boxZoom.disable();
    } else {
      map.scrollWheelZoom.enable();
      map.touchZoom.enable();
      map.doubleClickZoom.enable();
      map.boxZoom.enable();
    }
  }, [map, locked]);
  return null;
}
