import { useEffect } from "react";
import { useMap } from "react-leaflet";
import { savedViews } from "../mapState";

/** Saves center+zoom to the module-level map on every move/zoom end. */
export default function SaveView({
  viewKey,
  skip,
}: {
  viewKey: string;
  skip: boolean;
}) {
  const map = useMap();

  useEffect(() => {
    const save = () =>
      savedViews.set(viewKey, { center: map.getCenter(), zoom: map.getZoom() });

    if (skip) {
      map.on("moveend zoomend", save);
      return () => {
        map.off("moveend zoomend", save);
      };
    }

    const t = window.setTimeout(() => {
      map.on("moveend zoomend", save);
    }, 800);
    return () => {
      window.clearTimeout(t);
      map.off("moveend zoomend", save);
    };
  }, [map, viewKey, skip]);

  return null;
}
