import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This repo sits inside a parent directory that has its own package-lock;
  // pin the workspace root so Turbopack doesn't walk up past the git repo.
  turbopack: { root: import.meta.dirname },

  // React Compiler — auto-memoizes components at build time, replacing the
  // `@rolldown/plugin-babel` pass the Vite build used.
  //
  // Leave compilationMode at its default (`infer`). The Vite setup widened
  // Babel's *file* filter because the default `code` heuristic skipped whole
  // component files; that is a different knob. `compilationMode: "all"`
  // compiles every function as if it were a component, which broke the
  // zustand `create(...)` factories in src/lib/i18n.ts at runtime ("Invalid
  // hook call"). Next applies its own per-file heuristics before Babel, so
  // `true` is the equivalent here. Verify coverage with
  // `npx react-compiler-healthcheck`.
  reactCompiler: true,

  // The app is Swedish-first; the canonical host is https://badligan.club.
  // Trailing slashes off so /spot/x and /spot/x/ don't split crawl budget.
  trailingSlash: false,

  async headers() {
    return [
      {
        // Kill-switch service worker (public/sw.js) — must never be cached,
        // or a device stuck on the old Workbox SW never picks up the
        // unregistering one. Retire together with the file itself.
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, max-age=0, must-revalidate",
          },
        ],
      },
      {
        // Fonts are content-hashed by name and never rewritten in place.
        source: "/fonts/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
