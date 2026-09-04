/**
 * Public (client-visible) configuration. Next inlines any `NEXT_PUBLIC_*`
 * read at build time, so every value here ends up in the browser bundle —
 * nothing secret belongs in this list. Server-only secrets (e.g.
 * PERSPECTIVE_API_KEY) are read in Route Handlers from `process.env`
 * directly and are typed by @types/node.
 */
declare namespace NodeJS {
  interface ProcessEnv {
    readonly NEXT_PUBLIC_FIREBASE_API_KEY?: string;
    readonly NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?: string;
    readonly NEXT_PUBLIC_FIREBASE_PROJECT_ID?: string;
    readonly NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?: string;
    readonly NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?: string;
    readonly NEXT_PUBLIC_FIREBASE_APP_ID?: string;
    readonly NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID?: string;
    readonly NEXT_PUBLIC_USE_FIREBASE_EMULATORS?: string;
    readonly NEXT_PUBLIC_FIREBASE_EMULATOR_HOST?: string;
    readonly NEXT_PUBLIC_CARTO_API_KEY?: string;
  }
}
