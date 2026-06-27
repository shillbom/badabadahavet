import { describe, it, expect } from "vitest";
import { readImageSize, checkImageFile, MAX_IMAGE_PIXELS } from "./image";

function fileOf(bytes: number[], type: string): File {
  return new File([new Uint8Array(bytes)], "img", { type });
}

/** Minimal JPEG: SOI + SOF0 carrying the given dimensions, zero-padded. */
function jpeg(width: number, height: number): File {
  const b = [
    0xff,
    0xd8, // SOI
    0xff,
    0xc0, // SOF0
    0x00,
    0x11, // segment length
    0x08, // precision
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x00,
    0x00,
    0x00,
    0x00, // pad past the 16-byte minimum
  ];
  return fileOf(b, "image/jpeg");
}

function png(width: number, height: number): File {
  const b = [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a, // signature
    0x00,
    0x00,
    0x00,
    0x0d, // IHDR length
    0x49,
    0x48,
    0x44,
    0x52, // "IHDR"
    (width >>> 24) & 0xff,
    (width >>> 16) & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
    (height >>> 24) & 0xff,
    (height >>> 16) & 0xff,
    (height >>> 8) & 0xff,
    height & 0xff,
  ];
  return fileOf(b, "image/png");
}

function gif(width: number, height: number): File {
  const b = [
    0x47,
    0x49,
    0x46,
    0x38,
    0x39,
    0x61, // "GIF89a"
    width & 0xff,
    (width >> 8) & 0xff, // LE
    height & 0xff,
    (height >> 8) & 0xff,
    0,
    0,
    0,
    0,
    0,
    0,
  ];
  return fileOf(b, "image/gif");
}

function webpVP8X(width: number, height: number): File {
  const w = width - 1;
  const h = height - 1;
  const b = [
    0x52,
    0x49,
    0x46,
    0x46, // "RIFF"
    0,
    0,
    0,
    0, // file size (ignored)
    0x57,
    0x45,
    0x42,
    0x50, // "WEBP"
    0x56,
    0x50,
    0x38,
    0x58, // "VP8X"
    0,
    0,
    0,
    0, // chunk size
    0,
    0,
    0,
    0, // flags (4 bytes)
    w & 0xff,
    (w >> 8) & 0xff,
    (w >> 16) & 0xff, // 24-bit LE width-1
    h & 0xff,
    (h >> 8) & 0xff,
    (h >> 16) & 0xff, // 24-bit LE height-1
  ];
  return fileOf(b, "image/webp");
}

describe("readImageSize", () => {
  it("parses JPEG SOF dimensions", async () => {
    expect(await readImageSize(jpeg(1920, 1080))).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it("parses a panorama-sized JPEG", async () => {
    expect(await readImageSize(jpeg(12000, 9000))).toEqual({
      width: 12000,
      height: 9000,
    });
  });

  it("parses PNG IHDR dimensions", async () => {
    expect(await readImageSize(png(800, 600))).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("parses GIF dimensions", async () => {
    expect(await readImageSize(gif(320, 240))).toEqual({
      width: 320,
      height: 240,
    });
  });

  it("parses WebP (VP8X) dimensions", async () => {
    expect(await readImageSize(webpVP8X(4000, 3000))).toEqual({
      width: 4000,
      height: 3000,
    });
  });

  it("returns null for unrecognised bytes", async () => {
    expect(
      await readImageSize(fileOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "x")),
    ).toBeNull();
  });
});

describe("checkImageFile", () => {
  it("accepts a normal photo", async () => {
    expect(await checkImageFile(jpeg(4032, 3024))).toBeNull();
  });

  it("rejects an image over the pixel limit (the panorama case)", async () => {
    // 12000 x 9000 = 108 MP, well over the limit.
    expect(12000 * 9000).toBeGreaterThan(MAX_IMAGE_PIXELS);
    expect(await checkImageFile(jpeg(12000, 9000))).toBe("too-large");
  });

  it("rejects a non-image file", async () => {
    expect(await checkImageFile(fileOf([0, 1, 2, 3], "application/pdf"))).toBe(
      "not-image",
    );
  });
});
