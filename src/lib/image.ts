/**
 * Client-side image down-scaling before uploading to Storage. Phones
 * routinely produce 4–8 MB photos; for the leaderboard thumbnails and
 * popup strips we only ever display them at a few hundred pixels, so
 * resizing locally saves bandwidth, storage cost and load time.
 *
 * Falls back to the original file when:
 *   - it's already small enough (under `skipBelowBytes`) AND not huge-dimensioned
 *   - the type isn't a raster image we can decode
 *
 * Throws an {@link ImageProcessingError} (rather than crashing the tab or
 * silently uploading a multi-hundred-megapixel file) when an image is too
 * large to handle — e.g. a stitched panorama. The caller turns that into a
 * friendly "pick a smaller image" message. See {@link checkImageFile} for
 * validating a file up-front, before the user even submits.
 */

/** Reject files larger than this many bytes outright. */
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024; // 30 MB
/**
 * Reject images with more than this many pixels. Decoding a bitmap costs
 * ~4 bytes/pixel, so this bounds peak memory (~200 MB at the limit) and
 * keeps us clear of mobile out-of-memory crashes. Normal phone photos are
 * 12–48 MP; this only rejects stitched panoramas / 100+ MP sensor shots.
 */
export const MAX_IMAGE_PIXELS = 50 * 1_000_000; // 50 MP

/** How long to wait for a single decode before giving up (avoids a hung tab). */
const DECODE_TIMEOUT_MS = 20_000;

export type ImageRejectReason = "not-image" | "too-large" | "unreadable";

export class ImageProcessingError extends Error {
  reason: ImageRejectReason;
  constructor(reason: ImageRejectReason) {
    super(`image ${reason}`);
    this.name = "ImageProcessingError";
    this.reason = reason;
  }
}

export type CompressOptions = {
  /** Longest edge of the output, in pixels. */
  maxEdge?: number;
  /** JPEG quality, 0–1. */
  quality?: number;
  /** Skip compression for files smaller than this. */
  skipBelowBytes?: number;
};

function isHeic(file: File): boolean {
  return /heic|heif/.test(file.type);
}

/**
 * Validate a freshly-picked file before doing any heavy work. Returns a
 * rejection reason, or `null` when the file is fine to upload. Cheap: only
 * reads the file header for dimensions, never decodes the full image.
 */
export async function checkImageFile(
  file: File,
): Promise<ImageRejectReason | null> {
  if (!file.type.startsWith("image/")) return "not-image";
  if (file.size > MAX_IMAGE_BYTES) return "too-large";
  // HEIC headers aren't parsed below; rely on the byte cap for those.
  if (isHeic(file)) return null;
  const size = await readImageSize(file).catch(() => null);
  if (size && size.width * size.height > MAX_IMAGE_PIXELS) return "too-large";
  return null;
}

export async function compressImage(
  file: File,
  opts: CompressOptions = {},
): Promise<File> {
  const maxEdge = opts.maxEdge ?? 1600;
  const quality = opts.quality ?? 0.82;
  const skipBelow = opts.skipBelowBytes ?? 500 * 1024;

  if (!file.type.startsWith("image/")) return file;
  // HEIC/HEIF can't be decoded by canvas in most browsers — let it
  // pass through and rely on Storage to handle it.
  if (isHeic(file)) return file;

  if (file.size > MAX_IMAGE_BYTES) throw new ImageProcessingError("too-large");

  // Read dimensions from the header first (cheap) so a highly-compressed
  // panorama — small in bytes but enormous in pixels — is rejected before
  // we ever try to decode it.
  const size = await readImageSize(file).catch(() => null);
  if (size && size.width * size.height > MAX_IMAGE_PIXELS)
    throw new ImageProcessingError("too-large");

  // Small files that are also within our display bounds don't need
  // re-encoding. A small *byte* size with huge *dimensions* still falls
  // through so we downscale it.
  if (file.size <= skipBelow) {
    if (!size) return file;
    if (size.width <= maxEdge && size.height <= maxEdge) return file;
  }

  try {
    const bitmap = await loadBitmap(file);
    try {
      const { width, height } = scaleToFit(
        bitmap.width,
        bitmap.height,
        maxEdge,
      );
      if (
        width >= bitmap.width &&
        height >= bitmap.height &&
        file.size <= 1.5 * 1024 * 1024
      ) {
        // Already within bounds and not enormous — don't bother re-encoding.
        return file;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, width, height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (!blob) throw new ImageProcessingError("unreadable");

      // Replace extension with .jpg so the storage object's name matches
      // the encoded type.
      const base = file.name.replace(/\.[^.]+$/, "");
      return new File([blob], `${base}.jpg`, {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
    } finally {
      if ("close" in bitmap) bitmap.close();
    }
  } catch (err) {
    if (err instanceof ImageProcessingError) throw err;
    // Decode/encode failed for an unexpected reason. For small originals
    // (e.g. an exotic format canvas can't read) fall back to uploading the
    // file as-is. For anything large, surface an error rather than push a
    // multi-MB file that may exceed Storage limits or break clients.
    if (file.size <= skipBelow) return file;
    throw new ImageProcessingError("unreadable");
  }
}

/**
 * Generate a tiny base64 JPEG (LQIP — "low-quality image placeholder")
 * from a photo. Only a few hundred bytes; stored on the session and shown
 * blurred under the real image until it loads, so there's no blank/empty
 * frame and no layout shift.
 *
 * Returns `undefined` (never throws) when the file can't be decoded — the
 * caller simply skips the placeholder and shows the full image directly.
 * Pass it the already-compressed file (≤ maxEdge) so it never decodes a
 * full-resolution original.
 */
export async function makeThumbDataUrl(
  file: File,
  opts: { maxEdge?: number; quality?: number } = {},
): Promise<string | undefined> {
  const maxEdge = opts.maxEdge ?? 28;
  const quality = opts.quality ?? 0.4;

  if (!file.type.startsWith("image/")) return undefined;
  if (isHeic(file)) return undefined;

  // Don't try to decode an enormous image just for a 28px thumbnail.
  const size = await readImageSize(file).catch(() => null);
  if (size && size.width * size.height > MAX_IMAGE_PIXELS) return undefined;

  try {
    const bitmap = await loadBitmap(file);
    try {
      const { width, height } = scaleToFit(
        bitmap.width,
        bitmap.height,
        maxEdge,
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, width);
      canvas.height = Math.max(1, height);
      const ctx = canvas.getContext("2d");
      if (!ctx) return undefined;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      // Guard against anything unexpectedly large; the function rejects
      // thumbs over ~4000 chars, so keep ourselves comfortably under that.
      if (!dataUrl.startsWith("data:image/jpeg") || dataUrl.length > 4000)
        return undefined;
      return dataUrl;
    } finally {
      if ("close" in bitmap) bitmap.close();
    }
  } catch {
    return undefined;
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap is much faster and handles EXIF orientation in
  // modern browsers. Fall back to a plain <img> if unavailable.
  if (typeof createImageBitmap === "function") {
    try {
      return await withTimeout(
        createImageBitmap(file, { imageOrientation: "from-image" }),
      );
    } catch {
      // some browsers don't support the options bag — retry without it
      try {
        return await withTimeout(createImageBitmap(file));
      } catch {
        /* fall through to <img> */
      }
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await withTimeout(
      new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("decode failed"));
        el.src = url;
      }),
    );
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Reject a decode that takes too long so the upload never hangs forever. */
function withTimeout<T>(p: Promise<T>, ms = DECODE_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("decode timed out")),
      ms,
    );
    p.then(
      (v) => {
        window.clearTimeout(timer);
        resolve(v);
        return;
      },
      (e) => {
        window.clearTimeout(timer);
        reject(e);
        return;
      },
    );
  });
}

function scaleToFit(w: number, h: number, maxEdge: number) {
  if (w <= maxEdge && h <= maxEdge) return { width: w, height: h };
  const ratio = w > h ? maxEdge / w : maxEdge / h;
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}

/**
 * Read an image's pixel dimensions straight from its file header, without
 * decoding the whole thing into memory. Supports JPEG, PNG, GIF and WebP —
 * enough to catch oversized panoramas before they reach a canvas. Returns
 * `null` for formats we can't parse (the caller then falls back to a guarded
 * decode). Only the first 1 MB is inspected, which comfortably covers the
 * header of every real-world file.
 */
export async function readImageSize(
  file: File,
): Promise<{ width: number; height: number } | null> {
  const buf = await file.slice(0, 1 << 20).arrayBuffer();
  const view = new DataView(buf);
  if (view.byteLength < 16) return null;
  try {
    return jpegSize(view) ?? pngSize(view) ?? gifSize(view) ?? webpSize(view);
  } catch {
    return null;
  }
}

function jpegSize(view: DataView): { width: number; height: number } | null {
  if (view.getUint16(0) !== 0xffd8) return null; // SOI
  const len = view.byteLength;
  let off = 2;
  while (off + 4 <= len) {
    if (view.getUint8(off) !== 0xff) {
      off++; // resync to next marker
      continue;
    }
    let marker = view.getUint8(off + 1);
    // Skip any run of 0xFF padding bytes between markers.
    while (marker === 0xff && off + 2 < len) {
      off++;
      marker = view.getUint8(off + 1);
    }
    off += 2;
    // Markers without a payload: SOI, EOI, RSTn.
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      (marker >= 0xd0 && marker <= 0xd7)
    )
      continue;
    if (off + 2 > len) break;
    const segLen = view.getUint16(off);
    // Start-Of-Frame markers carry the dimensions (skip DHT/JPG/DAC).
    const isSOF =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSOF) {
      if (off + 7 > len) break;
      const height = view.getUint16(off + 3);
      const width = view.getUint16(off + 5);
      return { width, height };
    }
    if (segLen < 2) break;
    off += segLen;
  }
  return null;
}

function pngSize(view: DataView): { width: number; height: number } | null {
  // 89 50 4E 47 0D 0A 1A 0A, then IHDR chunk (width/height as big-endian u32).
  if (view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a)
    return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function gifSize(view: DataView): { width: number; height: number } | null {
  // "GIF8" then width/height as little-endian u16.
  if (view.getUint32(0) !== 0x47494638) return null;
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

function webpSize(view: DataView): { width: number; height: number } | null {
  // "RIFF" .... "WEBP"
  if (view.getUint32(0) !== 0x52494646 || view.getUint32(8) !== 0x57454250)
    return null;
  const fourcc = view.getUint32(12);
  if (fourcc === 0x56503820) {
    // "VP8 " (lossy): 14-bit dims at offset 26/28.
    const width = view.getUint16(26, true) & 0x3fff;
    const height = view.getUint16(28, true) & 0x3fff;
    return { width, height };
  }
  if (fourcc === 0x5650384c) {
    // "VP8L" (lossless): 14-bit (dim-1) packed after a 0x2F signature byte.
    const bits = view.getUint32(21, true);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  }
  if (fourcc === 0x56503858) {
    // "VP8X" (extended): 24-bit (dim-1) little-endian at offset 24.
    const width =
      ((view.getUint8(24) |
        (view.getUint8(25) << 8) |
        (view.getUint8(26) << 16)) +
        1) >>>
      0;
    const height =
      ((view.getUint8(27) |
        (view.getUint8(28) << 8) |
        (view.getUint8(29) << 16)) +
        1) >>>
      0;
    return { width, height };
  }
  return null;
}
