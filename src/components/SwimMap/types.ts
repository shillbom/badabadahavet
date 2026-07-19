import type { LatLngExpression } from "leaflet";
import type L from "leaflet";
import type { ReactNode, RefObject } from "react";
import type { PlaceWithTemp, SessionDoc } from "@/lib/types";

/** An achievement-rank ring applied to the current user's own pins. */
export type PinRing = { id: string; ring: string; glow: string };

/** A button rendered in the map's top-right action stack. The map appends
 *  its own built-in actions (e.g. satellite toggle) after these, so the
 *  buttons end up in a consistent vertical list regardless of how many
 *  the caller passes. */
export type MapAction = {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  ariaLabel?: string;
};

/** One cycling button in the ⋯ filter menu (see `menuToggles`): either
 *  a boolean on/off state, or a multi-state filter when `options` is present. */
export type MapMenuToggle =
  | {
      label: string;
      icon?: ReactNode;
      checked: boolean;
      onChange: (next: boolean) => void;
    }
  | {
      label: string;
      icon?: ReactNode;
      value: string;
      options: { value: string; label: string }[];
      onSelect: (value: string) => void;
    };

export type SwimMapProps = {
  places: PlaceWithTemp[];
  sessionsByPlace: Map<string, SessionDoc[]>;
  center?: LatLngExpression;
  zoom?: number;
  onPick?: (lat: number, lng: number) => void;
  pickedAt?: { lat: number; lng: number } | null;
  className?: string;
  linkToSpot?: boolean;
  userLocation?: { lat: number; lng: number } | null;
  /** Caller-supplied buttons rendered above the built-in map actions
   *  (satellite toggle, etc.). Stacked vertically so the layout stays
   *  consistent regardless of which actions are present. */
  topRightActions?: MapAction[];
  /** Collapses the top-right controls into a single ⋯ button that opens
   *  a filter menu: these rows plus a built-in satellite row. When set,
   *  `topRightActions` and the standalone satellite pill are not shown. */
  menuToggles?: MapMenuToggle[];
  /** Bumping this triggers a re-fit to all places. */
  fitToken?: number;
  /** When set, clicking an existing place pin offers a "use this spot" action. */
  onPickExisting?: (place: PlaceWithTemp) => void;
  /** Highlight one place's pin with an "active" icon — used when the
   *  user has picked an existing place. The standalone new-swim pin is
   *  then suppressed so we don't double up. */
  activePlaceId?: string | null;
  /** Disables panning while still allowing zoom (for "now" mode). */
  lockPan?: boolean;
  /** When set, the map re-centers on this point after every zoom so a
   *  zoomed-in user can't drift away from their current position. */
  keepCenteredOn?: { lat: number; lng: number } | null;
  /** Filter which existing places offer the "Use this spot" affordance.
   *  Defaults to all places when `onPickExisting` is set. */
  canPickExisting?: (place: PlaceWithTemp) => boolean;
  /** When true, suppresses the initial auto-fit-to-all-places so the
   *  map stays on the explicitly provided center/zoom. */
  skipInitialFit?: boolean;
  /** When true, fitBounds to the supplied places on load / fitToken bump.
   *  When false (default), the map centres on userLocation at a preset zoom
   *  instead of zooming out to fit all places. */
  fitBoundsToPlaces?: boolean;
  /** Optional ref that will be populated with the Leaflet Map instance,
   *  allowing the parent to call flyTo / setView imperatively. */
  mapRef?: RefObject<L.Map | null>;
  /** Stable key used to persist pan/zoom across unmounts (e.g. tab navigation).
   *  Maps with the same key share saved view state. Defaults to "default". */
  viewKey?: string;
  /** Pan/zoom to this place and open its popup when it changes. Pair with
   *  `focusToken` to re-trigger for the same place id. */
  focusPlaceId?: string | null;
  focusToken?: number;
  /** Adds a fullscreen toggle to the action stack. Fullscreen expands the
   *  map to cover the whole viewport and reveals a spot-search bar. */
  fullscreenControl?: boolean;
};

export type PopupState = {
  placeId: string | null;
  sessions: SessionDoc[] | null;
};
