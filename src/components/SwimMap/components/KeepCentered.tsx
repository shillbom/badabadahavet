import { useEffect } from "react";
import { useMap } from "react-leaflet";

export default function KeepCentered({
  target,
}: {
  target: { lat: number; lng: number };
}) {
  const map = useMap();
  useEffect(() => {
    const recenter = () => {
      map.setView([target.lat, target.lng], map.getZoom(), { animate: false });
    };
    recenter();
    map.on("zoomend", recenter);
    return () => {
      map.off("zoomend", recenter);
    };
  }, [map, target.lat, target.lng]);
  return null;
}
