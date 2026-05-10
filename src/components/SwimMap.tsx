import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L, { type LatLngExpression } from "leaflet";
import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import type { PlaceDoc, SessionDoc } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { useT } from "@/lib/i18n";

// Fix default marker icon paths for bundlers (Leaflet's default icons are broken under Vite).
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })
  ._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const dropletIcon = L.divIcon({
  className: "swim-pin",
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  popupAnchor: [0, -24],
  html: `<div style="
    transform: translateY(-4px);
    width: 28px; height: 28px;
    border-radius: 14px 14px 14px 2px;
    background: linear-gradient(135deg,#019eea,#065684);
    box-shadow: 0 4px 12px rgba(2,100,160,0.45);
    border: 2px solid white;
    transform-origin: bottom left;
    transform: rotate(-45deg) translateY(-4px);
  "></div>`,
});

export type SwimMapProps = {
  places: PlaceDoc[];
  sessionsByPlace: Map<string, SessionDoc[]>;
  center?: LatLngExpression;
  zoom?: number;
  onPick?: (lat: number, lng: number) => void;
  pickedAt?: { lat: number; lng: number } | null;
  className?: string;
  linkToSpot?: boolean;
};

export default function SwimMap({
  places,
  sessionsByPlace,
  center,
  zoom = 5,
  onPick,
  pickedAt,
  className,
  linkToSpot = true,
}: SwimMapProps) {
  const t = useT();
  const fallbackCenter: LatLngExpression = useMemo(() => {
    if (places.length) return [places[0].lat, places[0].lng];
    return [59.32, 18.06]; // Stockholm — a wholesome default for swim spots
  }, [places]);

  return (
    <div className={className} style={{ position: "relative" }}>
      <MapContainer
        center={center ?? fallbackCenter}
        zoom={zoom}
        scrollWheelZoom
        className="h-full w-full rounded-2xl"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitToPlaces places={places} />
        {places.map((p) => {
          const sessions = sessionsByPlace.get(p.id) ?? [];
          return (
            <Marker
              key={p.id}
              position={[p.lat, p.lng]}
              icon={dropletIcon}
            >
              <Popup>
                <div className="text-sm">
                  <div className="font-semibold text-wave-900">{p.name}</div>
                  <div className="text-[11px] text-slate-500">
                    {sessions.length === 1
                      ? t("map.popup.swims_one")
                      : t("map.popup.swims_many", { n: sessions.length })}
                  </div>
                  <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                    {sessions.slice(0, 5).map((s) => (
                      <li key={s.id} className="text-[11px]">
                        {formatDate(s.date)} — {s.displayName}
                        {s.isWinter ? " ❄️" : ""}
                      </li>
                    ))}
                  </ul>
                  {linkToSpot ? (
                    <Link
                      to={`/spot/${p.id}`}
                      className="mt-1.5 inline-block text-[11px] font-semibold text-wave-700 hover:underline"
                    >
                      {t("map.popup.see_full_history")}
                    </Link>
                  ) : null}
                </div>
              </Popup>
            </Marker>
          );
        })}
        {pickedAt ? (
          <Marker position={[pickedAt.lat, pickedAt.lng]} icon={dropletIcon} />
        ) : null}
        {onPick ? <ClickToPick onPick={onPick} /> : null}
      </MapContainer>
    </div>
  );
}

function FitToPlaces({ places }: { places: PlaceDoc[] }) {
  const map = useMap();
  useEffect(() => {
    if (!places.length) return;
    const bounds = L.latLngBounds(places.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds.pad(0.25), { animate: true, maxZoom: 12 });
  }, [places, map]);
  return null;
}

function ClickToPick({
  onPick,
}: {
  onPick: (lat: number, lng: number) => void;
}) {
  const map = useMap();
  useEffect(() => {
    const handler = (e: L.LeafletMouseEvent) =>
      onPick(e.latlng.lat, e.latlng.lng);
    map.on("click", handler);
    return () => {
      map.off("click", handler);
    };
  }, [map, onPick]);
  return null;
}
