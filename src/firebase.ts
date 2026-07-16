import { initializeApp, type FirebaseOptions } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
  CACHE_SIZE_UNLIMITED,
} from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import {
  getFunctions,
  connectFunctionsEmulator,
  httpsCallable,
  httpsCallableFromURL,
  type HttpsCallable,
} from "firebase/functions";
const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "demo-key",
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ??
    "demo-badabadahavet.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "demo-badabadahavet",
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ??
    "demo-badabadahavet.appspot.com",
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "000000000000",
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID ??
    "1:000000000000:web:0000000000000000000000",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Persistent (IndexedDB) cache so a returning visit resumes every listener
// from local data and only downloads the delta — without it each boot
// re-reads the full `places` collection (~4k docs) and the whole year's
// community feed from the server. Multi-tab manager so a second open tab
// shares the cache instead of failing to acquire it; browsers without
// IndexedDB fall back to the in-memory cache with a console warning.
// Cache size is unbounded: the default 40 MB LRU can evict the year's
// community feed + place data, forcing cold re-reads on the next boot —
// exactly the reads the persistent cache exists to avoid.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
    cacheSizeBytes: CACHE_SIZE_UNLIMITED,
  }),
});
export const storage = getStorage(app);
export const functions = getFunctions(app, "europe-west1");

const useEmulators =
  import.meta.env.VITE_USE_FIREBASE_EMULATORS === "1" ||
  import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true";

if (useEmulators && typeof window !== "undefined") {
  const host =
    import.meta.env.VITE_FIREBASE_EMULATOR_HOST ?? window.location.hostname;
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectStorageEmulator(storage, host, 9199);
  connectFunctionsEmulator(functions, host, 5001);
}

setPersistence(auth, browserLocalPersistence).catch(() => {
  /* ignored — falls back to in-memory */
});

// Firebase Analytics is consent-gated (see lib/consent.ts). Initialising it —
// which is what sets the analytics cookies and sends the first hit — only
// happens once the user has explicitly opted in, so nothing is collected by
// default. The module is imported dynamically so it stays out of the
// boot-critical firebase chunk.

// True when analytics *could* run here, i.e. asking for consent is meaningful:
// a real (non-emulator) build with a configured measurementId, in a browser.
export const analyticsConfigured =
  !useEmulators &&
  typeof window !== "undefined" &&
  Boolean(firebaseConfig.measurementId);

let analytics: import("firebase/analytics").Analytics | null = null;
let analyticsInit = false;

/**
 * Apply the user's analytics consent choice.
 *  - granted: initialise analytics once (no-op if already running).
 *  - denied: if analytics already started this session, stop collecting.
 *    (Cookies already set clear on their own; a reload won't re-init because
 *    the stored choice is "denied".)
 * No-op entirely unless analytics is configured for this environment.
 */
export function applyAnalyticsConsent(granted: boolean): void {
  if (!analyticsConfigured) return;
  if (granted && !analyticsInit) {
    analyticsInit = true;
    import("firebase/analytics")
      .then(async ({ getAnalytics, isSupported }) => {
        if (await isSupported()) analytics = getAnalytics(app);
        return;
      })
      .catch(() => {
        analyticsInit = false; // allow a retry if consent is granted again
      });
  } else if (!granted && analytics) {
    import("firebase/analytics")
      .then(({ setAnalyticsCollectionEnabled }) => {
        if (analytics) setAnalyticsCollectionEnabled(analytics, false);
        return;
      })
      .catch(() => {
        /* best-effort — ignore failures */
      });
  }
}

/**
 * Create a callable for a Cloud Function.
 *
 *  - Emulator: the SDK talks to the local Functions emulator.
 *  - Local dev (Vite, not Firebase Hosting): there's no `/api/*` rewrite, so
 *    call the deployed function directly (its CORS is enabled). Without this,
 *    `${origin}/api/<name>` just hits the dev server and every callable —
 *    logging a swim, joining a group, refreshing temps — silently fails.
 *  - Production (served by Firebase Hosting): route through the same-origin
 *    `/api/*` rewrite to avoid CORS and keep it first-party.
 */
export function cloudFn<Req, Res>(name: string): HttpsCallable<Req, Res> {
  if (useEmulators) {
    return httpsCallable<Req, Res>(functions, name);
  }
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const isLocalhost =
    host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (isLocalhost) {
    return httpsCallable<Req, Res>(functions, name);
  }
  return httpsCallableFromURL<Req, Res>(
    functions,
    `${window.location.origin}/api/${name}`,
  );
}
