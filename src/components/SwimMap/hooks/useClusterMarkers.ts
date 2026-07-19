import L from "leaflet";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { PlaceWithTemp } from "@/lib/types";
import { clusterIconHtml, hasFreshTemp, recencyFactor } from "../pinUtils";

// Cluster only once at least CLUSTER_ON pins are within the current viewport;
// stop clustering below CLUSTER_OFF. The gap is hysteresis — panning across a
// single threshold would otherwise thrash the cluster group, which has to
// remount to change its radius.
const CLUSTER_ON = 15;
const CLUSTER_OFF = 12;

// Stable key for a place's position so we can look up its temperature
// from a cluster's child markers (which only expose lat/lng, not the
// original PlaceWithTemp).
function clusterPosKey(lat: number, lng: number): string {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/**
 * Cluster derivation, extracted so the deliberate ref/memo machinery that
 * keeps the cluster group from remounting stays in one place. Runs inline
 * during render (a hook is just a function call), so render timing is
 * identical to inlining it in {@link SwimMap}.
 */
export function useClusterMarkers({
  places,
  activePlaceId,
  focusPlaceId,
  searchFocus,
  inViewCount,
}: {
  places: PlaceWithTemp[];
  activePlaceId?: string | null;
  focusPlaceId?: string | null;
  searchFocus: { id: string } | null;
  inViewCount: number | null;
}) {
  const clusteringRef = useRef(false);

  // Position → fresh temperature, so a cluster can average the temps of
  // its child markers. Held in a ref the (stable) cluster icon builder
  // reads, so updating temps doesn't recreate the cluster group.
  const tempByPos = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of places) {
      if (hasFreshTemp(p)) m.set(clusterPosKey(p.lat, p.lng), p.waterTemp);
    }
    return m;
  }, [places]);
  const tempByPosRef = useRef(tempByPos);
  useEffect(() => {
    tempByPosRef.current = tempByPos;
  }, [tempByPos]);

  // Position → last-swim timestamp, so a cluster can tint itself by the
  // most-recently-swum place beneath it (same ref trick as temps).
  const lastSwimByPos = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of places) {
      if (typeof p.lastSwimAt === "number")
        m.set(clusterPosKey(p.lat, p.lng), p.lastSwimAt);
    }
    return m;
  }, [places]);
  const lastSwimByPosRef = useRef(lastSwimByPos);
  useEffect(() => {
    lastSwimByPosRef.current = lastSwimByPos;
  }, [lastSwimByPos]);

  const createClusterIcon = useCallback(
    (cluster: {
      getAllChildMarkers: () => L.Marker[];
      getChildCount: () => number;
    }) => {
      const lookup = tempByPosRef.current;
      const swimLookup = lastSwimByPosRef.current;
      let sum = 0;
      let n = 0;
      let latestSwim = 0;
      for (const m of cluster.getAllChildMarkers()) {
        const ll = m.getLatLng();
        const posKey = clusterPosKey(ll.lat, ll.lng);
        const temp = lookup.get(posKey);
        if (typeof temp === "number") {
          sum += temp;
          n++;
        }
        const swim = swimLookup.get(posKey);
        if (typeof swim === "number" && swim > latestSwim) latestSwim = swim;
      }
      return L.divIcon({
        html: clusterIconHtml(
          cluster.getChildCount(),
          n ? sum / n : null,
          recencyFactor(latestSwim || undefined),
        ),
        className: "swim-cluster",
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      });
    },
    [],
  );

  // The active (being-picked) and focused places are pulled out of the
  // cluster group so they're always their own visible pin — never swallowed
  // by a cluster bubble. And with only a handful of pins we skip clustering
  // entirely so every place stays individually tappable.
  const unclusteredIds = useMemo(
    () =>
      new Set(
        [activePlaceId, focusPlaceId, searchFocus?.id].filter(
          (id): id is string => !!id,
        ),
      ),
    [activePlaceId, focusPlaceId, searchFocus],
  );
  const clusterablePlaces = useMemo(
    () => places.filter((p) => !unclusteredIds.has(p.id)),
    [places, unclusteredIds],
  );
  const unclusteredPlaces = useMemo(
    () => places.filter((p) => unclusteredIds.has(p.id)),
    [places, unclusteredIds],
  );

  // Cluster based on how many pins are actually in view. Before the first
  // measurement, fall back to the total so a busy map starts clustered (no
  // flash of hundreds of individual markers). Hysteresis between the two
  // thresholds keeps the group from remounting as you pan over the edge.
  let shouldCluster: boolean;
  if (inViewCount == null) {
    shouldCluster = clusterablePlaces.length >= CLUSTER_ON;
  } else if (inViewCount >= CLUSTER_ON) {
    shouldCluster = true;
  } else if (inViewCount < CLUSTER_OFF) {
    shouldCluster = false;
  } else {
    // Deliberate: inside the hysteresis band we hold the previous decision, so
    // the cluster group doesn't remount as you pan over the edge (see the note
    // above). This ref read is the mechanism, not a bug — keep it.
    // react-doctor-disable-next-line react-hooks-js/refs
    shouldCluster = clusteringRef.current;
  }
  useEffect(() => {
    clusteringRef.current = shouldCluster;
  }, [shouldCluster]);

  // `shouldCluster` carries the deliberate hysteresis value read from
  // clusteringRef above (see the note there); returning it is intentional,
  // not a stray ref read during render.
  // react-doctor-disable-next-line react-hooks-js/refs
  return {
    clusterablePlaces,
    unclusteredPlaces,
    shouldCluster,
    createClusterIcon,
  };
}
