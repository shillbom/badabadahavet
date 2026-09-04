// Text moderation via Google's Perspective API (Comment Analyzer).
// Mirrored by src/lib/moderation.ts for client-side pre-checks — same
// attributes and thresholds; keep the two in sync (same pattern as
// scoring.js / src/lib/scoring.ts).

// Production attributes that support Swedish (the app's main language)
// and English. Requesting an attribute a language doesn't support fails
// the whole request, so stick to this set.
export const PERSPECTIVE_ATTRIBUTES = [
  "TOXICITY",
  "SEVERE_TOXICITY",
  "PROFANITY",
  "INSULT",
  "IDENTITY_ATTACK",
  "THREAT",
];

// Perspective is known to over-score some non-English languages, so the
// general threshold is deliberately high (block only when the model is
// quite sure). SEVERE_TOXICITY has far fewer false positives and gets a
// lower bar.
export const SEVERE_TOXICITY_THRESHOLD = 0.5;
export const DEFAULT_THRESHOLD = 0.8;

/** True when any attribute score crosses its blocking threshold. */
export function isTextBlocked(scores) {
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
export function parseScores(body) {
  const out = {};
  const attrs =
    body && typeof body === "object" ? (body.attributeScores ?? {}) : {};
  for (const [name, entry] of Object.entries(attrs)) {
    const value = entry?.summaryScore?.value;
    if (typeof value === "number") out[name] = value;
  }
  return out;
}

/**
 * Ask Perspective whether `text` is acceptable. Fails OPEN — returns true
 * when the key is missing, the API errors, or the call times out —
 * because moderation must never block legitimate writes on an outage.
 */
export async function checkTextAllowed(
  text,
  apiKey,
  { fetchImpl = fetch, timeoutMs = 5000 } = {},
) {
  if (!apiKey || !text || !text.trim()) return true;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetchImpl(
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
