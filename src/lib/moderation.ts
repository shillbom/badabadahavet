// Client-side text moderation. The Perspective call itself now happens on
// the server (app/api/moderate) — PERSPECTIVE_API_KEY is a server-only
// secret and no longer ships to the browser. This module just asks that
// route and keeps the score/threshold helpers, which are still unit-tested
// here and mirrored by src/server/moderation.js — same attributes and
// thresholds; keep the two in sync (same pattern as scoring.js /
// scoring.ts).
//
// This is a UX pre-check, not the security boundary: display names,
// group names and place names are client-written under the Firestore
// rules, and a hostile client can skip this. Session notes and place
// names get the authoritative re-check inside /api/logSession,
// /api/updateSession and /api/setPlaceInfo.

// The scoring helpers below still live here: they are the client-side twin
// of src/server/moderation.js (unit-tested in moderation.test.ts) and they
// document the thresholds the server enforces. The attribute list itself
// only matters where the request is built, i.e. server-side.
//
// Perspective is known to over-score some non-English languages, so the
// general threshold is deliberately high (block only when the model is
// quite sure). SEVERE_TOXICITY has far fewer false positives and gets a
// lower bar.
export const SEVERE_TOXICITY_THRESHOLD = 0.5;
export const DEFAULT_THRESHOLD = 0.8;

/** Thrown when a name/note is rejected — call sites map it to an i18n toast. */
export class ModerationError extends Error {
  constructor() {
    super("Text rejected by moderation");
    this.name = "ModerationError";
  }
}

/** True when any attribute score crosses its blocking threshold. */
export function isTextBlocked(scores: Record<string, number>): boolean {
  for (const [attr, score] of Object.entries(scores)) {
    if (typeof score !== "number") continue;
    const limit =
      attr === "SEVERE_TOXICITY"
        ? SEVERE_TOXICITY_THRESHOLD
        : DEFAULT_THRESHOLD;
    if (score >= limit) return true;
  }
  return false;
}

/** Extract `{ ATTRIBUTE: summaryScore }` from a Perspective response body. */
export function parseScores(body: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const attrs =
    body && typeof body === "object"
      ? ((body as { attributeScores?: unknown }).attributeScores ?? {})
      : {};
  for (const [name, entry] of Object.entries(
    attrs as Record<string, { summaryScore?: { value?: unknown } }>,
  )) {
    const value = entry?.summaryScore?.value;
    if (typeof value === "number") out[name] = value;
  }
  return out;
}

/**
 * Ask the server whether `text` is acceptable. Fails OPEN — returns true
 * when the route is unreachable, answers an error, or moderation is
 * disabled server-side (no key configured) — because moderation must never
 * block writes on an outage. The route fails open the same way, so a
 * blocked verdict only ever comes from an actual Perspective score.
 *
 * Deliberately unauthenticated-tolerant: signup checks a chosen display
 * name before the auth account exists, so there is no ID token to send yet
 * and /api/moderate does not require one.
 */
export async function checkTextAllowed(text: string): Promise<boolean> {
  if (!text.trim()) return true;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    let res: Response;
    try {
      res = await fetch("/api/moderate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.slice(0, 2000) }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return true;
    const body: unknown = await res.json();
    return (body as { allowed?: unknown })?.allowed !== false;
  } catch {
    return true;
  }
}

/** Like `checkTextAllowed`, but throws `ModerationError` on rejection. */
export async function assertTextAllowed(text: string): Promise<void> {
  if (!(await checkTextAllowed(text))) throw new ModerationError();
}
