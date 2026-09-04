// The one firebase-admin app for all server code (Route Handlers and, from
// Phase 3, server components). Server-authoritative writes go through these
// handles: the Admin SDK bypasses firestore.rules, which is exactly why
// clients can't write `sessions` docs or `users.scores` themselves.
//
// Initialisation is lazy and idempotent. Next's dev server hot-reloads
// modules and App Hosting reuses instances, so `initializeApp()` would
// otherwise run twice and throw "app already exists" — `getApps()` is the
// guard. Keep this module free of top-level side effects for the same
// reason: nothing here runs until a request actually asks for a handle.

import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth as adminGetAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  getStorage as adminGetStorage,
  type Storage,
} from "firebase-admin/storage";

const useEmulators =
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "1" ||
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === "true";

/**
 * Point the Admin SDK at the local emulators. The SDK reads these from the
 * environment (there is no programmatic switch), so they have to be set
 * before the first `getFirestore()`/`getAuth()` call — hence doing it here
 * rather than expecting `.env.local` to carry them. Only the hosts the
 * emulator config in firebase.json actually binds are set.
 */
function applyEmulatorEnv(): void {
  const host = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST ?? "127.0.0.1";
  process.env.FIRESTORE_EMULATOR_HOST ??= `${host}:8080`;
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= `${host}:9099`;
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= `${host}:9199`;
}

function ensureApp(): App {
  const existing = getApps();
  if (existing.length > 0) return existing[0]!;
  if (useEmulators) applyEmulatorEnv();
  // No credential is passed: on App Hosting / Cloud Run the SDK picks up the
  // service account from the metadata server, and locally it uses
  // GOOGLE_APPLICATION_CREDENTIALS or `gcloud auth application-default login`.
  // Against the emulators any project id will do, so fall back to the public
  // one the client is already configured with.
  return initializeApp({
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  });
}

/** The Admin Firestore handle. Bypasses security rules — server only. */
export function getDb(): Firestore {
  return getFirestore(ensureApp());
}

/** The Admin Auth handle — `verifyIdToken`, user lookups, ban/disable. */
export function getAuth(): Auth {
  return adminGetAuth(ensureApp());
}

/** The Admin Storage handle — swim-photo cleanup. */
export function getStorage(): Storage {
  return adminGetStorage(ensureApp());
}

/** The default Storage bucket (swim photos live here). */
export function getBucket() {
  return getStorage().bucket();
}

// Re-exported so route handlers get FieldValue from the same admin instance
// they got their Firestore handle from.
export { FieldValue, Timestamp } from "firebase-admin/firestore";
