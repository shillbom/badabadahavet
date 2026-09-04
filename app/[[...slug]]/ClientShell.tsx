"use client";

import dynamic from "next/dynamic";

/**
 * `ssr: false` on the whole SPA root, not just <App>: react-router's
 * <BrowserRouter> reads window.history at construction, so rendering it on
 * the server throws "document is not defined". Nothing here needs to be in
 * the HTML anyway — the pre-paint gradient in app/layout.tsx covers the gap
 * exactly like the old index.html did, and the routes that DO need real HTML
 * (see app/spot/[placeId]) are server components outside this boundary.
 */
const SpaRoot = dynamic(() => import("./SpaRoot"), { ssr: false });

export default function ClientShell() {
  return <SpaRoot />;
}
