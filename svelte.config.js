import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Single-page-app build. `fallback` makes every unknown path serve the
    // shell so client-side routing (and Firebase deep links like /spot/:id)
    // work on a static host. Firebase Hosting rewrites point at this file.
    adapter: adapter({
      fallback: "index.html",
      pages: "build",
      assets: "build",
      precompress: false,
    }),
    // Preserve the React app's `@/...` import convention so the
    // framework-agnostic lib/ files carry over untouched.
    alias: {
      "@": "src",
      "@/*": "src/*",
    },
  },
};

export default config;
