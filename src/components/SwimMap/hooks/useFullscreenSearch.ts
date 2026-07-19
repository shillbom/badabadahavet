import { useEffect, useRef, useState } from "react";
import type { PlaceWithTemp } from "@/lib/types";

/** Alphabetical place-name comparator for the spot-search results. */
const byPlaceName = (a: PlaceWithTemp, b: PlaceWithTemp) =>
  a.name.localeCompare(b.name);

/**
 * Fullscreen state plus the fullscreen-only spot search. Picking a result
 * sets a `searchFocus` point (with a bumped token) that {@link SwimMap} feeds
 * to its focus machinery; coordinates are captured at pick time so a Firestore
 * re-emit of `places` can't re-trigger the flight.
 */
export function useFullscreenSearch(places: PlaceWithTemp[]) {
  const [fullscreen, setFullscreen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchFocus, setSearchFocus] = useState<{
    lat: number;
    lng: number;
    id: string;
    token: number;
  } | null>(null);
  const searchSeq = useRef(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const searchResults = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const starts: PlaceWithTemp[] = [];
    const contains: PlaceWithTemp[] = [];
    for (const p of places) {
      const name = p.name.toLowerCase();
      if (name.startsWith(q)) starts.push(p);
      else if (name.includes(q)) contains.push(p);
    }
    return [
      ...starts.toSorted(byPlaceName),
      ...contains.toSorted(byPlaceName),
    ].slice(0, 8);
  })();

  const pickSearchResult = (p: PlaceWithTemp) => {
    setSearchFocus({
      lat: p.lat,
      lng: p.lng,
      id: p.id,
      token: ++searchSeq.current,
    });
    setQuery("");
    searchInputRef.current?.blur();
  };

  const toggleFullscreen = () => {
    setFullscreen((v) => !v);
    setQuery("");
    setSearchFocus(null);
  };

  // Escape exits fullscreen (desktop nicety). The listener is only attached
  // while fullscreen, so Escape always means "exit" — set state directly via
  // the (stable) setters rather than depending on toggleFullscreen, so the
  // effect only re-subscribes when `fullscreen` actually changes.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setFullscreen(false);
      setQuery("");
      setSearchFocus(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  return {
    fullscreen,
    toggleFullscreen,
    query,
    setQuery,
    searchResults,
    pickSearchResult,
    searchInputRef,
    searchFocus,
  };
}
