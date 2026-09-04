"use client";

import { Suspense, lazy, useEffect } from "react";
import { BrowserRouter } from "react-router";
import { installAppHeight } from "@/lib/appHeight";
import { BootSplash } from "@/components/Splash";

// App is lazy so the Firebase/Leaflet/page chunks load *after* first paint.
// Auth state lives in the Zustand store (no provider needed), so importing
// the store — and with it the ~618 KB Firebase chunk — happens inside this
// boundary rather than eagerly on the critical path.
const App = lazy(() => import("@/App"));

export default function SpaRoot() {
  // Keep --app-height honest for the rest of the session. The first value is
  // written by an inline script in app/layout.tsx (before first paint); this
  // installs the resize/orientation/pageshow listeners and the scroll nudge
  // that unsticks iOS's launch viewport. See src/lib/appHeight.ts.
  useEffect(() => {
    installAppHeight();
  }, []);

  return (
    <BrowserRouter>
      <Suspense fallback={null}>
        <App />
      </Suspense>
      {/* BootSplash is mounted outside the lazy boundary so it paints before
          the app chunk loads. It's pure CSS + a tiny signal, so it stays off
          the critical path, and it animates itself out once App is ready. */}
      <BootSplash />
    </BrowserRouter>
  );
}
