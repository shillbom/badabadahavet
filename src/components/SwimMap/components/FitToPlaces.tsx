import { useEffect, useRef } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import type { PlaceWithTemp } from "@/lib/types";
import { fittedMaps } from "../mapState";

export default function FitToPlaces({
  places,
  userLocation,
  fitToken,
  skipInitialFit,
  fitBoundsToPlaces = false,
}: {
  places: PlaceWithTemp[];
  userLocation: { lat: number; lng: number } | null;
  fitToken?: number;
  skipInitialFit?: boolean;
  fitBoundsToPlaces?: boolean;
}) {
  const map = useMap();
  const lastFitToken = useRef(fitToken);

  useEffect(() => {
    const container = map.getContainer();
    const tokenChanged = fitToken !== lastFitToken.current;
    lastFitToken.current = fitToken;

    const alreadyFitted = fittedMaps.has(container);
    if (alreadyFitted && !tokenChanged) return;
    if (skipInitialFit && !tokenChanged) {
      fittedMaps.add(container);
      return;
    }

    map.invalidateSize({ animate: false });

    if (fitBoundsToPlaces) {
      if (!places.length) {
        if (userLocation)
          map.setView([userLocation.lat, userLocation.lng], 11, {
            animate: false,
          });
        return;
      }
      const pts: [number, number][] = places.map((p) => [p.lat, p.lng]);
      if (userLocation) pts.push([userLocation.lat, userLocation.lng]);
      if (pts.length === 1) {
        map.setView(pts[0], 13, { animate: true });
      } else {
        const bounds = L.latLngBounds(pts);
        map.fitBounds(bounds.pad(0.25), { animate: true, maxZoom: 13 });
      }
      fittedMaps.add(container);
    } else if (userLocation) {
      map.setView([userLocation.lat, userLocation.lng], 11, { animate: true });
      fittedMaps.add(container);
    }
  }, [places, userLocation, map, fitToken, fitBoundsToPlaces, skipInitialFit]);
  return null;
}
