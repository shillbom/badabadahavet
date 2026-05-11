import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
