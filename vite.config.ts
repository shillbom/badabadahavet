import { defineConfig } from "vite";

import { VitePWA } from "vite-plugin-pwa";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
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
        // Cache OpenStreetMap tiles so the map works offline.
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
              test: /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/,
              priority: 50,
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
