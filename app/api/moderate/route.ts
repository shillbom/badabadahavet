/**
 * POST /api/moderate — the client-side moderation pre-check, moved behind
 * the server so PERSPECTIVE_API_KEY never ships to the browser.
 *
 *   body: { text: string }
 *   returns: { allowed: boolean }
 *
 * This is the UX pre-check for text the Firestore rules let clients write
 * themselves (display names, group names, place names picked in the UI) —
 * NOT a security boundary: a hostile client just skips it. Session notes
 * and place info get the authoritative re-check inside /api/logSession,
 * /api/updateSession and /api/setPlaceInfo.
 *
 * Deliberately does NOT call requireUser: `LoginPage` checks a chosen
 * display name *before* creating the auth account, so at that moment
 * there is no ID token to send. Requiring one would silently disable
 * name moderation for exactly the signup flow that needs it most (signup
 * is open — see the "app is public" note in the project docs). Instead the
 * exposure is bounded by a short text cap and a coarse per-IP cap so the
 * key can't be farmed as a free public Perspective proxy.
 *
 * Fails OPEN in every failure mode — no key configured, Perspective
 * erroring, a timeout, a malformed body, or the rate cap — because
 * moderation must never block a legitimate swim. Thresholds and the
 * Swedish/English attribute set live in src/server/moderation.js.
 */

import { route } from "@/server/api";
import { textAllowed } from "@/server/moderate";

export const runtime = "nodejs";

// Perspective itself only looks at the first 2000 chars (see
// checkTextAllowed); anything longer is not a name or a note.
const MAX_TEXT = 2000;

// Coarse per-instance, per-IP cap. Not a security control — a deterrent
// against someone scripting the endpoint. Names/notes are typed by hand, so
// a real user never comes close.
const PER_IP_PER_HOUR = 120;
const HOUR_MS = 60 * 60 * 1000;
const hits = new Map<string, number[]>();

function withinRateLimit(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < HOUR_MS);
  // Bound the map so a long-lived instance can't accumulate IPs forever.
  if (hits.size > 5000) hits.clear();
  if (recent.length >= PER_IP_PER_HOUR) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  return true;
}

export const POST = route(async (req) => {
  let text = "";
  try {
    const body = await req.json();
    if (typeof body?.text === "string") text = body.text;
  } catch {
    return { allowed: true };
  }
  if (!text.trim() || text.length > MAX_TEXT) return { allowed: true };

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!withinRateLimit(ip)) return { allowed: true };

  return { allowed: await textAllowed(text) };
});
