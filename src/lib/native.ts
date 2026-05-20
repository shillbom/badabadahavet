import { Capacitor } from "@capacitor/core";

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
