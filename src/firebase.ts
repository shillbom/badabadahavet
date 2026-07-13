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
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
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

// Firebase Analytics — only in real (non-emulator) builds, only when the
// browser supports it (no SSR, not blocked by privacy add-ons, etc.) and
// only when a measurementId was actually configured. Imported dynamically
// so the analytics module stays out of the boot-critical firebase chunk.
if (
  !useEmulators &&
  typeof window !== "undefined" &&
  firebaseConfig.measurementId
) {
  import("firebase/analytics")
    .then(async ({ getAnalytics, isSupported }) => {
      if (await isSupported()) getAnalytics(app);
      return;
    })
    .catch(() => {
      /* analytics is best-effort — ignore failures */
    });
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
