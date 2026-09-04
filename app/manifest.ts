import type { MetadataRoute } from "next";

/**
 * Web app manifest — ported verbatim from the old public/site.webmanifest.
 *
 * Offline is deliberately NOT a goal; "installable, runs as an app" is. That
 * needs this manifest and HTTPS, nothing else: iOS Add-to-Home-Screen and the
 * Chrome/desktop *menu* install both work without a service worker (the SW
 * requirement was dropped in Chrome 108/112). Only the automatic
 * `beforeinstallprompt` banner still needs one, and we don't build on it —
 * it's unsupported on Safari/iOS anyway. See components/InstallHint.tsx for
 * the iOS share-sheet nudge that covers the other half.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Badligan",
    short_name: "Badligan",
    description: "En liten, vänlig badtävling",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#eff9ff",
    theme_color: "#eff9ff",
    lang: "sv",
    categories: ["sports", "lifestyle"],
    icons: [
      {
        src: "/web-app-manifest-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/web-app-manifest-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/web-app-manifest-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/web-app-manifest-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
