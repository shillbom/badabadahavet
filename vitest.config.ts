import { defineConfig } from "vitest/config";
import path from "node:path";

// Dedicated test config (kept separate from vite.config.ts so the PWA /
// React plugins don't load during unit tests). Pure-logic tests run in a
// plain node environment for speed.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
