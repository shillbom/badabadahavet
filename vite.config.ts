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
      // New SW activates and takes over immediately on next navigation.
      registerType: "autoUpdate",
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
        // Split heavy libs into long-lived chunks so route-switches
        // don't redownload them and so initial JS stays small.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (
            id.includes("leaflet.markercluster") ||
            id.includes("react-leaflet-cluster") ||
            id.includes("react-leaflet") ||
            id.includes("/leaflet/")
          ) {
            return "leaflet";
          }
          if (id.includes("/firebase/") || id.includes("@firebase/")) {
            return "firebase";
          }
          if (id.includes("framer-motion")) {
            return "motion";
          }
          if (id.includes("lucide")) {
            return "lucide";
          }
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("react-router")
          ) {
            return "react";
          }
        },
      },
    },
  },
});
