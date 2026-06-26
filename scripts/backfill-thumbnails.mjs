#!/usr/bin/env node
/**
 * Re-runnable backfill of inline LQIP thumbnails (`photoThumb`) for swim
 * sessions logged before the thumbnail feature existed. For each session
 * that has a `photoUrl` but no `photoThumb`, it fetches the full image,
 * shrinks it to a tiny base64 JPEG data URL and stamps it onto the doc —
 * matching the shape produced client-side by `makeThumbDataUrl()` in
 * `src/lib/image.ts` (~28px wide, quality ~0.4, a `data:image/jpeg;base64,…`
 * URL kept under 4000 chars so the `logSession` Cloud Function accepts it).
 *
 * Uses jimp (pure-JS, no native deps) so it runs anywhere Node 24 does.
 * Writes go through the Admin SDK, which bypasses the Firestore rules that
 * forbid client session writes.
 *
 * Idempotent — safe to re-run; sessions that already have a `photoThumb`
 * are skipped.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     npm run backfill:thumbnails            # dry-run (no writes)
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
 *     npm run backfill:thumbnails -- --write  # commit
 */
import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";
import { Jimp } from "jimp";

const WRITE = process.argv.includes("--write");
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT ?? "badligan";

// Mirror the client thumbnail defaults; the Cloud Function rejects > 4000.
const MAX_CHARS = 4000;
// Progressively shrink/soften until the data URL fits under MAX_CHARS.
const ATTEMPTS = [
  { maxEdge: 28, quality: 40 },
  { maxEdge: 24, quality: 35 },
  { maxEdge: 20, quality: 30 },
  { maxEdge: 16, quality: 25 },
];

function initAdmin() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    return initializeApp({
      credential: cert(JSON.parse(readFileSync(credPath, "utf8"))),
      projectId: PROJECT_ID,
    });
  }
  return initializeApp({
    credential: applicationDefault(),
    projectId: PROJECT_ID,
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch the image at `url` and produce a tiny base64 JPEG data URL, or
 * return undefined if it can't be decoded / can't be shrunk under the
 * 4000-char limit. Never throws.
 */
async function makeThumb(url) {
  let buf;
  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    buf = Buffer.from(await res.arrayBuffer());
  } catch {
    return undefined;
  }

  for (const { maxEdge, quality } of ATTEMPTS) {
    try {
      const img = await Jimp.fromBuffer(buf);
      // Scale the longest edge down to maxEdge (only ever shrinks).
      if (img.bitmap.width >= img.bitmap.height) {
        if (img.bitmap.width > maxEdge) img.resize({ w: maxEdge });
      } else if (img.bitmap.height > maxEdge) {
        img.resize({ h: maxEdge });
      }
      const dataUrl = await img.getBase64("image/jpeg", { quality });
      if (
        dataUrl.startsWith("data:image/jpeg") &&
        dataUrl.length <= MAX_CHARS
      ) {
        return dataUrl;
      }
    } catch {
      return undefined;
    }
  }
  return undefined; // couldn't get it under the limit
}

const app = initAdmin();
const db = getFirestore(app);

const snap = await db.collection("sessions").get();

// Firestore can't query for a *missing* field, so filter in code: keep
// sessions with a string photoUrl and no existing photoThumb.
const candidates = snap.docs.filter((d) => {
  const s = d.data();
  return typeof s.photoUrl === "string" && typeof s.photoThumb !== "string";
});

console.log(
  `Scanned ${snap.size} session(s); ${candidates.length} have a photo and no thumbnail.`,
);

let updated = 0;
let skipped = 0;
const sampleSizes = [];

for (const doc of candidates) {
  const { photoUrl } = doc.data();
  const thumb = await makeThumb(photoUrl);
  if (!thumb) {
    console.warn(
      `  skip ${doc.id}: couldn't build a thumb under ${MAX_CHARS} chars`,
    );
    skipped++;
    continue;
  }
  if (sampleSizes.length < 3) sampleSizes.push(thumb.length);

  if (WRITE) {
    await db.collection("sessions").doc(doc.id).update({ photoThumb: thumb });
  }
  updated++;
  // Be gentle on Storage / Firestore; there are only a few dozen sessions.
  await sleep(50);
}

if (sampleSizes.length) {
  console.log(`Sample thumb sizes (chars): ${sampleSizes.join(", ")}`);
}

if (WRITE) {
  console.log(`Wrote photoThumb to ${updated} session(s); skipped ${skipped}.`);
} else {
  console.log(
    `Dry run — would write ${updated} session(s), skip ${skipped}. ` +
      `Pass --write to commit.`,
  );
}

process.exit(0);
