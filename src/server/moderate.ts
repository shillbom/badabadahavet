// Server-side entry point for Perspective moderation.
//
// PERSPECTIVE_API_KEY is a *server-only* secret (an App Hosting secret in
// production, plain `.env.local` locally) — it used to be a
// `defineSecret("PERSPECTIVE_API_KEY")` on the callables and, worse, a
// NEXT_PUBLIC_ twin shipped to the browser for the UX pre-check. Both are
// gone: the pre-check now posts to /api/moderate, so the key never leaves
// the server and there is one fewer API-key referrer restriction to keep.
//
// When the key is unset (emulator dev, a forgotten secret) moderation is
// skipped entirely — and checkTextAllowed itself fails OPEN on API errors
// and timeouts. That is deliberate: moderation must never block a
// legitimate swim on an outage.
//
// ⚠ ONE-TIME SETUP after this move: the key was previously used from the
// browser, so it carries an **HTTP-referrer** restriction. Server-side
// requests send no referrer, so Google answers
//   403 API_KEY_HTTP_REFERRER_BLOCKED ("Requests from referer <empty> are
//   blocked")
// and — because we fail open — moderation goes quietly inert. Verified
// against the live key on 2026-09-04. Fix it in the Cloud console: drop the
// referrer restriction on the Perspective key (keep the API restriction to
// Comment Analyzer). Losing the referrer allowlist is fine now that the key
// only lives on the server.

import { checkTextAllowed } from "./moderation.js";

/** The configured key, or "" when moderation is disabled here. */
export function perspectiveKey(): string {
  return process.env.PERSPECTIVE_API_KEY ?? "";
}

/**
 * True when `text` is acceptable. Fails open (see above) and returns true
 * immediately when no key is configured.
 */
export async function textAllowed(text: string): Promise<boolean> {
  const key = perspectiveKey();
  if (!key) return true;
  return checkTextAllowed(text, key) as Promise<boolean>;
}
