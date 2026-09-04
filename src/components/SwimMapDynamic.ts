"use client";

import dynamic from "next/dynamic";

/**
 * SwimMap, always client-only — import THIS, never `@/components/SwimMap`.
 *
 * Two reasons, both deliberate:
 *  - Leaflet reads `window` while its module initialises, so evaluating the
 *    map on the server throws "window is not defined".
 *  - The Leaflet + markercluster chunk is ~190 KB and must stay off first
 *    paint (see the SwimMap header for the rest of its performance notes).
 *
 * `ssr: false` covers both: Next neither server-renders the component nor
 * puts it in the server bundle, and the chunk loads on demand.
 */
const SwimMap = dynamic(() => import("@/components/SwimMap"), { ssr: false });

export default SwimMap;
