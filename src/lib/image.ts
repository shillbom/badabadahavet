/**
 * Client-side image down-scaling before uploading to Storage. Phones
 * routinely produce 4–8 MB photos; for the leaderboard thumbnails and
 * popup strips we only ever display them at a few hundred pixels, so
 * resizing locally saves bandwidth, storage cost and load time.
 *
 * Falls back to the original file when:
 *   - it's already small enough (under `skipBelowBytes`)
 *   - the type isn't a raster image we can decode
 *   - anything in the pipeline throws (so an upload never *fails*
 *     just because compression couldn't run)
 */
export type CompressOptions = {
  /** Longest edge of the output, in pixels. */
  maxEdge?: number;
  /** JPEG quality, 0–1. */
  quality?: number;
  /** Skip compression for files smaller than this. */
  skipBelowBytes?: number;
};

export async function compressImage(
  file: File,
  opts: CompressOptions = {},
): Promise<File> {
  const maxEdge = opts.maxEdge ?? 1600;
  const quality = opts.quality ?? 0.82;
  const skipBelow = opts.skipBelowBytes ?? 500 * 1024;

  if (file.size <= skipBelow) return file;
  if (!file.type.startsWith("image/")) return file;
  // HEIC/HEIF can't be decoded by canvas in most browsers — let it
  // pass through and rely on Storage to handle it.
  if (/heic|heif/.test(file.type)) return file;

  try {
    const bitmap = await loadBitmap(file);
    const { width, height } = scaleToFit(bitmap.width, bitmap.height, maxEdge);
    if (
      width >= bitmap.width &&
      height >= bitmap.height &&
      file.size <= 1.5 * 1024 * 1024
    ) {
      // Already within bounds and not enormous — don't bother re-encoding.
      if ("close" in bitmap) bitmap.close();
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    if ("close" in bitmap) bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!blob) return file;

    // Replace extension with .jpg so the storage object's name matches
    // the encoded type.
    const base = file.name.replace(/\.[^.]+$/, "");
    return new File([blob], `${base}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap is much faster and handles EXIF orientation in
  // modern browsers. Fall back to a plain <img> if unavailable.
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // some browsers don't support the options bag — retry without it
      try {
        return await createImageBitmap(file);
      } catch {
        /* fall through to <img> */
      }
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function scaleToFit(w: number, h: number, maxEdge: number) {
  if (w <= maxEdge && h <= maxEdge) return { width: w, height: h };
  const ratio = w > h ? maxEdge / w : maxEdge / h;
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}
