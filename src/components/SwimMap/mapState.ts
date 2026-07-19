import type L from "leaflet";

// Persists the last panned/zoomed view so navigating away and back
// restores the exact position instead of re-fitting everything.
export type SavedView = { center: L.LatLng; zoom: number };
export const savedViews = new Map<string, SavedView>();

// Module-level set so "already fitted" survives component re-renders.
// Keyed by Leaflet map container element so different map instances
// are independent. Cleared when the container is removed from the DOM.
export const fittedMaps = new WeakSet<HTMLElement>();
