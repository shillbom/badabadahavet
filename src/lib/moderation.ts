// Client-side text moderation via Google's Perspective API. Mirrors
// functions/moderation.js — same attributes and thresholds; keep the two
// in sync (same pattern as scoring.js / scoring.ts).
//
// This is a UX pre-check, not the security boundary: display names,
// group names and place names are client-written under the Firestore
// rules, and a hostile client can skip this. Session notes and place
// names get the authoritative re-check inside the logSession function.

// Production attributes that support Swedish (the app's main language)
// and English. Requesting an attribute a language doesn't support fails
// the whole request, so stick to this set.
const PERSPECTIVE_ATTRIBUTES = [
  "TOXICITY",
  "SEVERE_TOXICITY",
  "PROFANITY",
  "INSULT",
  "IDENTITY_ATTACK",
  "THREAT",
] as const;

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
 * Ask Perspective whether `text` is acceptable. Fails OPEN — returns true
 * when the key is missing (e.g. emulator dev), the API errors, or the
 * call times out — moderation must never block writes on an outage.
 */
export async function checkTextAllowed(text: string): Promise<boolean> {
  const apiKey = import.meta.env.VITE_PERSPECTIVE_API_KEY;
  if (!apiKey || !text.trim()) return true;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    let res: Response;
    try {
      res = await fetch(
        `https://commentanalyzer.googleapis.com/v1alpha1/comments:analyze?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            comment: { text: text.slice(0, 2000) },
            languages: ["sv", "en"],
            requestedAttributes: Object.fromEntries(
              PERSPECTIVE_ATTRIBUTES.map((a) => [a, {}]),
            ),
            doNotStore: true,
          }),
          signal: ctrl.signal,
        },
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return true;
    return !isTextBlocked(parseScores(await res.json()));
  } catch {
    return true;
  }
}

/** Like `checkTextAllowed`, but throws `ModerationError` on rejection. */
export async function assertTextAllowed(text: string): Promise<void> {
  if (!(await checkTextAllowed(text))) throw new ModerationError();
}
