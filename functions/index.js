// The `functions/` codebase is down to a single export.
//
// Everything that used to live here — the ten `onCall` callables plus the
// `sitemap` / `spotPreview` `onRequest` handlers — moved into the Next app:
// the callables are Route Handlers under `app/api/*` (shared logic in
// `src/server/*`), and the sitemap / share-card work is done by
// `app/sitemap.ts`, `app/robots.ts` and the server-rendered
// `/spot/[placeId]` page.
//
// `syncTempSummary` stays because Firebase App Hosting has no Firestore
// triggers. It is deployed on its own (`firebase deploy --only functions`);
// nothing else in this directory has a dependency on the app.

import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onDocumentWritten } from "firebase-functions/v2/firestore";

initializeApp();

const PROJECT_REGION = "europe-west1";

// Local copies of the two tempLogic helpers this trigger needs. The
// canonical (and unit-tested) versions are in src/server/tempLogic.js —
// this file is deployed as a standalone Cloud Functions codebase and can't
// import from the app tree, so these ten lines are mirrored on purpose,
// like src/lib/temps.ts mirrors the same shape for the client.
//
// A "reading" is the compact shape stored in tempSummary/current and
// placeTemps/{placeId}: { t: °C, at: epoch ms sampled, p: provider }.
function asReading(x) {
  if (!x) return null;
  if (typeof x.t !== "number" || Number.isNaN(x.t)) return null;
  if (typeof x.at !== "number" || Number.isNaN(x.at)) return null;
  if (typeof x.p !== "string") return null;
  return x;
}

/** Whichever of two readings was sampled most recently (null when both are
 *  missing). Ties keep `a` so a live per-place doc beats the daily summary. */
function freshestReading(a, b) {
  const ra = asReading(a);
  const rb = asReading(b);
  if (!ra) return rb;
  if (!rb) return ra;
  return rb.at > ra.at ? rb : ra;
}

// The map reads water temps only from the single `tempSummary/current` doc
// (never from placeTemps), so keep it in lockstep with every reading. This
// is the ONE place that folds placeTemps into the summary: /api/refreshPlaceTemp
// and the user-temp writes in /api/logSession and /api/updateSession all just
// write placeTemps and let this trigger fan the freshest reading into the map.
// (The daily sweep rebuilds the whole summary from placeTemps the same way;
// this keeps a freshly-added or just-refreshed spot current between sweeps.)
export const syncTempSummary = onDocumentWritten(
  { document: "placeTemps/{placeId}", region: PROJECT_REGION },
  async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return; // deletion — leave the summary untouched
    const reading = asReading(after.data());
    if (!reading) return; // no valid temp fields on the doc
    const placeId = event.params.placeId;
    const db = getFirestore();
    const summaryRef = db.doc("tempSummary/current");
    const snap = await summaryRef.get();
    const existing = snap.exists ? snap.data().entries?.[placeId] : null;
    // Never regress the map to an older reading (a user can log a temp for a
    // backdated swim, writing an older `at` into placeTemps).
    const winner = freshestReading(reading, existing);
    if (existing && winner.at === asReading(existing)?.at) return; // no change
    await summaryRef.set(
      { entries: { [placeId]: { t: winner.t, at: winner.at, p: winner.p } } },
      { merge: true },
    );
  },
);
