import { defineConfig } from "vitest/config";
import path from "node:path";

// Dedicated test config (the app itself is built by Next; this keeps
// vitest independent of the bundler). Pure-logic tests run in a
// plain node environment for speed.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.js"],
  },
});
