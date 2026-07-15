import { defineConfig } from "vite";

import { VitePWA } from "vite-plugin-pwa";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// React Compiler preset. Its default filter is a fast `code` heuristic that
// only runs Babel on files whose (already react-transformed) source *looks*
// component-y — but that has false-negatives, silently skipping ~8 real
// component files here. Replace it with a path filter so every app .tsx/.jsx
// is compiled (node_modules is already excluded by the plugin's defaults).
const compilerPreset = reactCompilerPreset({ target: "19" });
compilerPreset.rolldown.filter = { id: /\.[jt]sx(\?|$)/ };

export default defineConfig({
  plugins: [
    react(),
    // React Compiler — auto-memoizes components at build time (emits
    // react/compiler-runtime). On rolldown-vite the base transform is oxc, so
    // react()'s own `babel` option is ignored; the compiler must run as this
    // separate Babel pass right after react(). Filter widened above.
    // See npx react-compiler-healthcheck.
    babel({ presets: [compilerPreset] }),
    tailwindcss(),
    VitePWA({
      // We control activation ourselves (see App.tsx): apply a new version
      // automatically on first load, but only *prompt* to reload when an
      // update lands mid-session so we never interrupt an in-progress log.
      registerType: "prompt",
      // index.html already links /site.webmanifest — don't inject another one.
      manifest: false,
      includeAssets: [
        "favicon.ico",
        "favicon-96x96.png",
        "apple-touch-icon.png",
        "web-app-manifest-192x192.png",
        "web-app-manifest-512x512.png",
      ],
      workbox: {
        // Precache every built asset so the app works offline and chunk
        // 404s can't happen after a redeploy.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,webp}"],
        // SPA fallback so deep links work when offline.
        navigateFallback: "index.html",
        // Never intercept Firebase auth handler or any /__/* URLs —
        // the service worker must let those reach the network.
        navigateFallbackDenylist: [/^\/__\//],
        // Cache map tiles and swim photos so revisits (and offline use)
        // don't re-download them. Tiles/photos load via plain <img>, so the
        // responses are opaque — status 0 must be cacheable alongside 200.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/[a-z]\.tile\.openstreetmap\.org\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "osm-tiles",
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // CARTO basemaps — the default (voyager), light and dark themes.
            urlPattern: /^https:\/\/[a-z]\.basemaps\.cartocdn\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "carto-tiles",
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Esri/ArcGIS — satellite imagery, ocean base and place labels.
            urlPattern: /^https:\/\/(server|services)\.arcgisonline\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "esri-tiles",
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Session photos from Firebase Storage. Every upload gets a
            // unique path (timestamp + random suffix) and is never rewritten,
            // so CacheFirst with a long TTL is safe — a photo only leaves the
            // cache via the entry cap or deletion of the session itself.
            // Workbox only routes GETs, so uploads are unaffected.
            urlPattern: /^https:\/\/firebasestorage\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "swim-photos",
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 60 * 60 * 24 * 180, // 180 days
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        // Split heavy libs into long-lived chunks so route-switches don't
        // redownload them and initial JS stays small.
        //
        // `priority` matters: React (incl. react-dom, react-router, the JSX
        // runtime and the scheduler) must be claimed FIRST and removed from
        // every other group. Without this, rolldown leaks react/jsx-runtime
        // into whichever vendor chunk happens to reference it first (we saw it
        // land in `motion`/`leaflet`), which forces the entry — and therefore
        // the very first paint — to download those 100s of KB just to render.
        // Highest priority wins, so order by how badly we want each isolated.
        advancedChunks: {
          groups: [
            {
              name: "react",
              test: /[\\/]node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/,
              priority: 50,
            },
            {
              // Analytics is dynamically imported (see src/firebase.ts) and
              // must outrank the catch-all firebase group, or it gets folded
              // into the eagerly-loaded firebase chunk anyway.
              name: "firebase-analytics",
              test: /[\\/]node_modules[\\/]@?firebase[\\/]analytics[\\/]/,
              priority: 45,
            },
            {
              name: "firebase",
              test: /[\\/]node_modules[\\/]@?firebase[\\/]/,
              priority: 40,
            },
            {
              name: "leaflet",
              test: /[\\/]node_modules[\\/](leaflet|leaflet\.markercluster|react-leaflet|react-leaflet-cluster)[\\/]/,
              priority: 30,
            },
            {
              // Only ever loaded via the dynamic import in PixiLayer.tsx —
              // keep it in one stable named chunk (incl. pixi-only deps) so
              // it never bleeds into the entry.
              name: "pixi",
              test: /[\\/]node_modules[\\/](pixi\.js|@pixi|earcut|parse-svg-path|ismobilejs)[\\/]/,
              priority: 25,
            },
            {
              name: "motion",
              test: /[\\/]node_modules[\\/]framer-motion[\\/]/,
              priority: 20,
            },
            {
              name: "lucide",
              test: /[\\/]node_modules[\\/]lucide/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
});
