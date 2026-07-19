import { Marker } from "react-leaflet";
import type L from "leaflet";
import type { RefObject } from "react";
import type { PlaceWithTemp, SessionDoc } from "@/lib/types";
import type { PopupState } from "../types";
import PlacePopup from "./PlacePopup";

// Reuses the same [lat, lng] tuple across renders for a given place so
// <Marker position={...}> only gets a new array when the coordinates
// actually change. Leaflet's Marker.setLatLng fires a "move" event
// unconditionally (even when the value is unchanged), and inside a
// MarkerClusterGroup that event unconditionally rips the marker out of the
// cluster grid and re-adds it (leaflet.markercluster's _childMarkerMoved ->
// _moveChild). A fresh `[p.lat, p.lng]` literal on every render — which
// `places.map(...)` produces every time the Firestore listener re-emits —
// was therefore rebuilding every marker on the map on every re-render,
// which is what made clicking a pin (which re-renders SwimMap 2-3 times
// via popup autoPan) visibly flicker.
const positionCache = new Map<string, [number, number]>();
function stablePosition(
  id: string,
  lat: number,
  lng: number,
): [number, number] {
  const cached = positionCache.get(id);
  if (cached && cached[0] === lat && cached[1] === lng) return cached;
  const next: [number, number] = [lat, lng];
  positionCache.set(id, next);
  return next;
}

/**
 * One place pin. Shared by the clustered layer and the pulled-out
 * active/focused pins — they differ only in `key` and `icon`. In logging
 * mode a pickable pin selects the spot on click instead of opening a popup.
 */
export default function PlaceMarker({
  place,
  icon,
  markerRefs,
  mapRef,
  onPickExisting,
  canPickExisting,
  setPopup,
  popupSessionsFor,
  linkToSpot,
}: {
  place: PlaceWithTemp;
  icon: L.DivIcon;
  markerRefs: RefObject<Map<string, L.Marker>>;
  mapRef: RefObject<L.Map | null>;
  onPickExisting?: (place: PlaceWithTemp) => void;
  canPickExisting?: (place: PlaceWithTemp) => boolean;
  setPopup: React.Dispatch<React.SetStateAction<PopupState>>;
  popupSessionsFor: (placeId: string) => SessionDoc[];
  linkToSpot: boolean;
}) {
  // When logging a swim, clicking a pickable pin selects it immediately —
  // no popup button needed.
  const isPickable =
    !!onPickExisting && (!canPickExisting || canPickExisting(place));
  return (
    <Marker
      ref={(m) => {
        if (m) markerRefs.current.set(place.id, m);
        else markerRefs.current.delete(place.id);
      }}
      position={stablePosition(place.id, place.lat, place.lng)}
      icon={icon}
      eventHandlers={{
        click: () => {
          if (isPickable) {
            mapRef.current?.closePopup();
            onPickExisting(place);
          }
        },
        popupopen: () => setPopup({ placeId: place.id, sessions: null }),
        popupclose: () =>
          setPopup((current) =>
            current.placeId === place.id
              ? { placeId: null, sessions: null }
              : current,
          ),
      }}
    >
      {/* Only show popup when not in logging mode — clicking a pin while
          logging selects it immediately instead. */}
      {!isPickable ? (
        <PlacePopup
          place={place}
          sessions={popupSessionsFor(place.id)}
          linkToSpot={linkToSpot}
        />
      ) : null}
    </Marker>
  );
}
