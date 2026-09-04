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

  async rewrites() {
    // Firebase Auth's redirect/popup flows round-trip through
    // `https://<authDomain>/__/auth/handler`. That path is a RESERVED path
    // served automatically by Firebase Hosting — and App Hosting does not
    // serve it. So when badligan.club moved to App Hosting, the handler
    // started 404ing into this Next app and Google sign-in broke: the browser
    // came back from Google to a page that doesn't exist, getRedirectResult
    // never produced a session, and views/GoogleAuthPage sat on its splash
    // forever.
    //
    // Proxy the reserved paths to the project's firebaseapp.com domain, which
    // Firebase Auth always serves. This keeps `authDomain` set to our own
    // origin, which is the point: the handler stays SAME-ORIGIN as far as the
    // browser is concerned, so the auth state it writes isn't subject to the
    // cross-site storage restrictions that break the redirect flow on Safari
    // and in installed PWAs. (Pointing authDomain straight at
    // <project>.firebaseapp.com is the one-line alternative, and exactly the
    // cross-origin setup .env.example warns against.)
    //
    // Note this does NOT depend on our Firebase Hosting site: /__/auth/* on
    // <project>.firebaseapp.com is provisioned by Firebase Auth itself and
    // keeps working with no Hosting content deployed.
    const projectId =
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "demo-badabadahavet";
    return [
      {
        source: "/__/auth/:path*",
        destination: `https://${projectId}.firebaseapp.com/__/auth/:path*`,
      },
      {
        // The handler page loads this to discover the project's config.
        source: "/__/firebase/:path*",
        destination: `https://${projectId}.firebaseapp.com/__/firebase/:path*`,
      },
    ];
  },

  async headers() {
    return [
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
