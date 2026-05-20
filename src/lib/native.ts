import { Capacitor } from "@capacitor/core";
import {
  GoogleAuthProvider,
  signInWithCredential,
  type UserCredential,
} from "firebase/auth";
import { auth } from "@/firebase";

/**
 * Thin platform abstraction so the same React code runs as a web PWA
 * and inside the Capacitor wrapper. On native we use the Capacitor
 * plugins (real native pickers, real native permission prompts); on
 * the web we fall back to the browser APIs the app has always used.
 */

export const isNative = (): boolean => Capacitor.isNativePlatform();

export type Coords = { lat: number; lng: number };

export type GeoOptions = {
  enableHighAccuracy?: boolean;
  timeoutMs?: number;
  maximumAgeMs?: number;
};

export async function getCurrentPosition(
  opts: GeoOptions = {},
): Promise<Coords> {
  const {
    enableHighAccuracy = false,
    timeoutMs = 8000,
    maximumAgeMs = 5 * 60 * 1000,
  } = opts;

  if (isNative()) {
    const { Geolocation } = await import("@capacitor/geolocation");
    // The plugin handles the OS permission prompt the first time.
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy,
      timeout: timeoutMs,
      maximumAge: maximumAgeMs,
    });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  }

  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new Error("geolocation_unavailable");
  }

  return new Promise<Coords>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      {
        enableHighAccuracy,
        timeout: timeoutMs,
        maximumAge: maximumAgeMs,
      },
    );
  });
}

/**
 * Returns a File suitable for the same upload code that already handles
 * <input type="file">. On native we go through the Camera plugin so
 * the user gets a proper native camera UI; on the web we fall back to
 * clicking the supplied hidden <input> element.
 */
export async function pickPhoto(
  webFallbackInput: HTMLInputElement | null,
): Promise<File | null> {
  if (isNative()) {
    const { Camera, CameraResultType, CameraSource } =
      await import("@capacitor/camera");
    const photo = await Camera.getPhoto({
      quality: 80,
      allowEditing: false,
      resultType: CameraResultType.Uri,
      source: CameraSource.Prompt,
      saveToGallery: false,
    });
    if (!photo.webPath) return null;
    const blob = await fetch(photo.webPath).then((r) => r.blob());
    const ext = photo.format ?? "jpg";
    return new File([blob], `swim.${ext}`, {
      type: blob.type || `image/${ext}`,
    });
  }

  // Web: trigger the hidden <input type="file" capture> the page already renders.
  webFallbackInput?.click();
  return null;
}

/**
 * Native Google sign-in. Opens the OS-level account picker (Google
 * Sign-In on iOS, Google Play Services on Android) instead of the
 * Firebase web redirect flow — which is unreliable inside system
 * WebViews. The credential returned by the plugin is forwarded to the
 * Firebase JS SDK so the existing onAuthStateChanged listener fires
 * normally and the rest of the app sees a logged-in user.
 *
 * Only callable on native — guard with `isNative()` at the call site.
 */
export async function signInWithGoogleNative(): Promise<UserCredential> {
  const { FirebaseAuthentication } =
    await import("@capacitor-firebase/authentication");
  const result = await FirebaseAuthentication.signInWithGoogle();
  const idToken = result.credential?.idToken;
  const accessToken = result.credential?.accessToken;
  if (!idToken && !accessToken) {
    throw new Error("native_google_signin_missing_credential");
  }
  const credential = GoogleAuthProvider.credential(idToken, accessToken);
  return signInWithCredential(auth, credential);
}

/**
 * Sign out from the native account picker too, so the next sign-in
 * shows the account chooser rather than silently reusing the last
 * Google account. Called alongside Firebase JS signOut.
 */
export async function signOutNative(): Promise<void> {
  if (!isNative()) return;
  const { FirebaseAuthentication } =
    await import("@capacitor-firebase/authentication");
  try {
    await FirebaseAuthentication.signOut();
  } catch {
    // Best-effort — the JS SDK signOut is what actually matters.
  }
}
