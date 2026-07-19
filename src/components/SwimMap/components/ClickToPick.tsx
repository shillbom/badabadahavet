import { useEffect, useEffectEvent } from "react";
import type L from "leaflet";
import { useMap } from "react-leaflet";

export default function ClickToPick({
  onPick,
}: {
  onPick: (lat: number, lng: number) => void;
}) {
  const map = useMap();
  const pick = useEffectEvent(onPick);
  useEffect(() => {
    const handler = (e: L.LeafletMouseEvent) =>
      pick(e.latlng.lat, e.latlng.lng);
    map.on("click", handler);
    return () => {
      map.off("click", handler);
    };
  }, [map]);
  return null;
}
