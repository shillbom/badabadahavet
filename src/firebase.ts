import { initializeApp, type FirebaseOptions } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  setPersistence,
  browserLocalPersistence,
} from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getFunctions, connectFunctionsEmulator } from "firebase/functions";
import { getAnalytics, isSupported as analyticsSupported } from "firebase/analytics";

const firebaseConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "demo-key",
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ??
    "demo-badabadahavet.firebaseapp.com",
  projectId:
    import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "demo-badabadahavet",
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
export const db = getFirestore(app);
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
// only when a measurementId was actually configured.
if (
  !useEmulators &&
  typeof window !== "undefined" &&
  firebaseConfig.measurementId
) {
  analyticsSupported()
    .then((ok) => {
      if (ok) getAnalytics(app);
    })
    .catch(() => {
      /* analytics is best-effort — ignore failures */
    });
}
