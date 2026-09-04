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

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "demo-key",
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??
    "demo-badabadahavet.firebaseapp.com",
  projectId:
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "demo-badabadahavet",
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
    "demo-badabadahavet.appspot.com",
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "000000000000",
  appId:
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID ??
    "1:000000000000:web:0000000000000000000000",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
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

const useEmulators =
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "1" ||
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";

if (useEmulators && typeof window !== "undefined") {
  const host =
    process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST ?? window.location.hostname;
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectStorageEmulator(storage, host, 9199);
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

/** The shape a failed /api/* call returns: see `route()`/`ApiError` in
 *  src/server/api.ts. */
type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
};

/**
 * Error thrown by `callApi`. Deliberately mirrors what the Firebase
 * callable SDK used to throw, because UI code branches on it: `code` keeps
 * the `functions/` prefix (`src/lib/data.ts` tests for
 * `functions/not-found`) and `details` carries the server's `{ reason }`
 * (`moderation`, `date-range`, `season-locked`). Keeping the shape is what
 * made the callable → Route Handler swap invisible to call sites.
 */
export class ApiCallError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiCallError";
    this.status = status;
    this.code = `functions/${code}`;
    this.details = details;
  }
}

/**
 * Call one of the server Route Handlers in `app/api/*`.
 *
 * These used to be `onCall` Cloud Functions reached through the callable
 * SDK, which needed a three-way emulator / localhost / Hosting-rewrite
 * branch to find them. Now the server *is* the app (Next on App Hosting),
 * so every call is same-origin `POST /api/<name>` — no CORS, no rewrite
 * list, nothing to configure per environment.
 *
 * Auth is an `Authorization: Bearer <idToken>` header (Phase 0 of the
 * migration plan: no session cookies). The header is omitted when nobody is
 * signed in, and the route then answers 401 `unauthenticated` — the same
 * error the callables' `if (!req.auth)` guard produced.
 */
export async function callApi<Req, Res>(
  name: string,
  payload?: Req,
): Promise<Res> {
  const user = auth.currentUser;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;

  const res = await fetch(`/api/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload ?? {}),
  });

  if (!res.ok) {
    let body: ApiErrorBody = {};
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      /* non-JSON error page (a proxy, a crash) — fall back to the status */
    }
    throw new ApiCallError(
      res.status,
      body.error?.code ?? "internal",
      body.error?.message ?? `Request failed (${res.status})`,
      body.error?.details,
    );
  }

  return (await res.json()) as Res;
}
