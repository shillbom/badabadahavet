import { MapContainer, Marker, TileLayer } from "react-leaflet";
import L, { type LatLngExpression } from "leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import { useEffect, useRef, useState } from "react";
import { MAP_THEMES } from "@/lib/mapThemes";
import { watchPlaceSessions } from "@/lib/data";
import { pinRingFor } from "@/lib/borders";
import { cn } from "@/lib/utils";
import type { SessionDoc } from "@/lib/types";
import {
  activePlaceIcon,
  hasFreshTemp,
  newSwimIcon,
  pinIcon,
  recencyFactor,
  userLocationIcon,
} from "../pinUtils";
import { savedViews } from "../mapState";
import type { PopupState, SwimMapProps } from "../types";
import { useClusterMarkers } from "../hooks/useClusterMarkers";
import { useFullscreenSearch } from "../hooks/useFullscreenSearch";
import AutoInvalidateSize from "./AutoInvalidateSize";
import ClickToPick from "./ClickToPick";
import FitToPlaces from "./FitToPlaces";
import FocusPlace from "./FocusPlace";
import KeepCentered from "./KeepCentered";
import MapControlStack from "./MapControlStack";
import MapCornerButtons from "./MapCornerButtons";
import MapSpotSearch from "./MapSpotSearch";
import MapZoomLock from "./MapZoomLock";
import PlaceMarker from "./PlaceMarker";
import SaveView from "./SaveView";
import ViewportPinCount from "./ViewportPinCount";

import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })
  ._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

export default function SwimMap({
  places,
  sessionsByPlace,
  center,
  zoom = 5,
  onPick,
  pickedAt,
  className,
  linkToSpot = true,
  userLocation,
  fitToken,
  onPickExisting,
  activePlaceId,
  lockPan,
  keepCenteredOn,
  canPickExisting,
  skipInitialFit,
  fitBoundsToPlaces = false,
  mapRef: externalMapRef,
  viewKey = "default",
  topRightActions,
  menuToggles,
  focusPlaceId,
  focusToken,
  fullscreenControl,
}: SwimMapProps) {
  const [satellite, setSatellite] = useState(false);
  const [{ placeId: openPopupPlaceId, sessions: livePopupSessions }, setPopup] =
    useState<PopupState>({ placeId: null, sessions: null });

  useEffect(() => {
    if (!openPopupPlaceId) return;
    return watchPlaceSessions(openPopupPlaceId, (sessions) => {
      setPopup((current) =>
        current.placeId === openPopupPlaceId
          ? { ...current, sessions }
          : current,
      );
    });
  }, [openPopupPlaceId]);

  const popupSessionsFor = (placeId: string): SessionDoc[] =>
    openPopupPlaceId === placeId && livePopupSessions
      ? livePopupSessions
      : (sessionsByPlace.get(placeId) ?? []);

  const [inViewCount, setInViewCount] = useState<number | null>(null);
  const baseTheme = MAP_THEMES[0];
  const satelliteTheme = MAP_THEMES.find((st) => st.id === "satellite")!;
  const theme = satellite ? satelliteTheme : baseTheme;
  const fallbackCenter: LatLngExpression = (() => {
    if (userLocation) return [userLocation.lat, userLocation.lng];
    if (places.length) return [places[0].lat, places[0].lng];
    return [59.32, 18.06];
  })();
  const fallbackZoom = userLocation && places.length === 0 ? 12 : zoom;
  const mapRef = useRef<L.Map | null>(null);
  const markerRefs = useRef(new Map<string, L.Marker>());

  const {
    fullscreen,
    toggleFullscreen,
    query,
    setQuery,
    searchResults,
    pickSearchResult,
    searchInputRef,
    searchFocus,
  } = useFullscreenSearch(places);

  const focusTarget = (() => {
    if (searchFocus) return searchFocus;
    if (!focusPlaceId) return null;
    const p = places.find((pl) => pl.id === focusPlaceId);
    return p
      ? { lat: p.lat, lng: p.lng, id: p.id, token: focusToken ?? 0 }
      : null;
  })();
  const saved = savedViews.get(viewKey);

  const {
    clusterablePlaces,
    unclusteredPlaces,
    shouldCluster,
    createClusterIcon,
  } = useClusterMarkers({
    places,
    activePlaceId,
    focusPlaceId,
    searchFocus,
    inViewCount,
  });

  return (
    <div
      className={
        fullscreen
          ? "fixed inset-0 z-[1200] bg-slate-100"
          : cn("relative h-full w-full", className)
      }
    >
      <MapContainer
        center={saved?.center ?? center ?? fallbackCenter}
        zoom={saved?.zoom ?? fallbackZoom}
        scrollWheelZoom
        dragging={!lockPan}
        doubleClickZoom
        touchZoom
        boxZoom={!lockPan}
        keyboard={!lockPan}
        className={cn("h-full w-full", !fullscreen && "rounded-2xl")}
        ref={(m) => {
          mapRef.current = m;
          if (externalMapRef) externalMapRef.current = m;
        }}
      >
        <TileLayer
          key={theme.id}
          attribution={theme.attribution}
          url={theme.url}
          subdomains={theme.subdomains ?? "abc"}
          maxZoom={theme.maxZoom ?? 19}
        />
        {satellite ? (
          <TileLayer
            key="satellite-labels"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
            attribution=""
            maxZoom={20}
            opacity={1}
          />
        ) : null}
        <AutoInvalidateSize />
        <MapZoomLock locked={!!lockPan} />
        <SaveView viewKey={viewKey} skip={!!saved} />
        <FitToPlaces
          places={places}
          userLocation={userLocation ?? null}
          fitToken={fitToken}
          skipInitialFit={skipInitialFit || !!saved}
          fitBoundsToPlaces={fitBoundsToPlaces}
        />
        {keepCenteredOn ? <KeepCentered target={keepCenteredOn} /> : null}
        <FocusPlace target={focusTarget} markerRefs={markerRefs} />
        <ViewportPinCount places={clusterablePlaces} onCount={setInViewCount} />
        {userLocation ? (
          <Marker
            position={[userLocation.lat, userLocation.lng]}
            icon={userLocationIcon}
          />
        ) : null}
        <MarkerClusterGroup
          key={shouldCluster ? "clustered" : "flat"}
          chunkedLoading
          maxClusterRadius={shouldCluster ? 50 : 0}
          showCoverageOnHover={false}
          spiderfyOnMaxZoom
          iconCreateFunction={createClusterIcon}
        >
          {clusterablePlaces.map((p) => (
            <PlaceMarker
              key={p.id}
              place={p}
              icon={pinIcon(
                hasFreshTemp(p) ? p.waterTemp : null,
                pinRingFor(p.lastSwimBorder),
                recencyFactor(p.lastSwimAt),
              )}
              markerRefs={markerRefs}
              mapRef={mapRef}
              onPickExisting={onPickExisting}
              canPickExisting={canPickExisting}
              setPopup={setPopup}
              popupSessionsFor={popupSessionsFor}
              linkToSpot={linkToSpot}
            />
          ))}
        </MarkerClusterGroup>
        {unclusteredPlaces.map((p) => (
          <PlaceMarker
            key={`active-${p.id}`}
            place={p}
            icon={activePlaceIcon}
            markerRefs={markerRefs}
            mapRef={mapRef}
            onPickExisting={onPickExisting}
            canPickExisting={canPickExisting}
            setPopup={setPopup}
            popupSessionsFor={popupSessionsFor}
            linkToSpot={linkToSpot}
          />
        ))}
        {pickedAt && !activePlaceId ? (
          <Marker position={[pickedAt.lat, pickedAt.lng]} icon={newSwimIcon} />
        ) : null}
        {onPick ? <ClickToPick onPick={onPick} /> : null}
      </MapContainer>

      {fullscreenControl && fullscreen ? (
        <MapSpotSearch
          query={query}
          setQuery={setQuery}
          searchResults={searchResults}
          pickSearchResult={pickSearchResult}
          searchInputRef={searchInputRef}
          sessionsByPlace={sessionsByPlace}
        />
      ) : null}

      <MapControlStack
        menuToggles={menuToggles}
        satellite={satellite}
        setSatellite={setSatellite}
        topRightActions={topRightActions}
        fullscreen={fullscreen}
      />

      <MapCornerButtons
        fullscreenControl={fullscreenControl}
        fullscreen={fullscreen}
        toggleFullscreen={toggleFullscreen}
        userLocation={userLocation}
        mapRef={mapRef}
      />
    </div>
  );
}
