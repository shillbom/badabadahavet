import type { GroupDoc, SessionDoc } from "./types";
import { reactorUids } from "./data";

/**
 * "While you were away" digest — what changed since the user's previous
 * visit. Pure, dependency-free (so it's trivially testable): the caller
 * feeds it the raw sessions/groups it already streams plus a per-device
 * reaction baseline, and gets back a ready-to-render summary.
 *
 * Two kinds of news:
 *  - swims:     people *in your groups* logged dips since you last looked.
 *               Only group-mates — never the whole app's community feed.
 *  - reactions: someone reacted to one of *your* swims since you last looked
 *               (any reactor — it's your own content).
 *
 * Swims are detected server-side-ish via `createdAt > since` (works across
 * devices). Reactions carry no timestamp on the session doc, so "new" is
 * derived by diffing the current reactor count against a snapshot we stash
 * in localStorage — device-local, which is fine for an ephemeral popup.
 */

/** Don't bother with a digest for a quick reload — only a real "away" gap. */
export const MIN_AWAY_MS = 60 * 60 * 1000; // 1 hour
/** Keep the popup glanceable. */
export const MAX_ITEMS = 8;
/** Look-back window when the user opens the digest by hand from the header. */
export const MANUAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // ~last month

export type AwaySwims = {
  kind: "swims";
  uid: string;
  /** Most recent display name we saw for this swimmer. */
  name: string;
  /** How many swims they logged while you were away. */
  count: number;
  /** Their most recent swim — used for the place label and the deep link. */
  latest: SessionDoc;
};

export type AwayReactions = {
  kind: "reactions";
  /** Your swim that picked up reactions. */
  session: SessionDoc;
  /** How many new reactors since you last looked. */
  newCount: number;
  /** The emoji currently on this swim, most-reacted first. */
  emojis: string[];
};

export type AwayItem = AwaySwims | AwayReactions;

export type WhileAwayDigest = {
  /** The baseline timestamp this digest looks back to. */
  since: number;
  items: AwayItem[];
  /** Distinct other swimmers in the digest. */
  swimmerCount: number;
  /** Total swims logged by others while you were away. */
  totalSwims: number;
  /** Total new reactions across your swims. */
  reactionCount: number;
};

export type DigestInput = {
  myUid: string;
  /** Previous-visit timestamp; null means first ever visit (no digest). */
  since: number | null;
  /** The current user's own swims (used for reaction diffing). */
  mySessions: SessionDoc[];
  /** This year's community swims (the global feed). Filtered down to your
   *  group-mates before anything is surfaced. */
  allSessions: SessionDoc[];
  /** The user's groups — only swimmers you share a group with appear. */
  groups: GroupDoc[];
  /** Per-session total reactor count last surfaced on this device. */
  reactionBaseline: Record<string, number>;
  now: number;
  /** Manual launch from the header: look back a fixed window (default
   *  ~last month), skip the away / first-visit guards, always return a
   *  digest (even empty), and surface reactions by swim recency rather than
   *  the unseen-since-baseline diff. */
  manual?: boolean;
  /** Override the manual look-back window (defaults to MANUAL_WINDOW_MS). */
  windowMs?: number;
};

/** Sum every reactor across every emoji on a session. */
export function reactionTotal(s: SessionDoc): number {
  const r = s.reactions ?? {};
  let n = 0;
  for (const emoji in r) n += reactorUids(r[emoji]).length;
  return n;
}

/** Emoji on a session that have at least one reactor, most-reacted first. */
function topEmojis(s: SessionDoc): string[] {
  const r = s.reactions ?? {};
  return Object.keys(r)
    .filter((e) => reactorUids(r[e]).length > 0)
    .toSorted((a, b) => reactorUids(r[b]).length - reactorUids(r[a]).length);
}

/**
 * Compute the digest. In auto mode returns null when there's nothing worth
 * interrupting for (first visit, too-recent a reload, or genuinely no news).
 * In manual mode (header launch) it always returns a digest — possibly with
 * no items — so the caller can show an explicit empty state.
 */
export function computeWhileAwayDigest(
  input: DigestInput,
): WhileAwayDigest | null {
  const { myUid, since, mySessions, allSessions, groups, reactionBaseline } =
    input;
  const manual = input.manual ?? false;

  // Resolve the look-back point. Manual launch always looks back a fixed
  // window; auto looks back to the previous visit (and bows out for a
  // first-ever visit or a quick reload).
  let lookBack: number;
  if (manual) {
    lookBack = input.now - (input.windowMs ?? MANUAL_WINDOW_MS);
  } else {
    if (since == null) return null;
    if (input.now - since < MIN_AWAY_MS) return null;
    lookBack = since;
  }

  // ── Swims by your group-mates since you last looked ───────────────────
  // Strictly limited to people you share a group with — we never surface the
  // whole app's community feed. No groups → no swim items (reactions only).
  const myGroupMates = new Set<string>();
  for (const g of groups)
    for (const m of g.members) if (m !== myUid) myGroupMates.add(m);

  const bySwimmer = new Map<string, AwaySwims>();
  for (const s of allSessions) {
    if (!myGroupMates.has(s.uid)) continue; // group-mates only (excludes me)
    if (s.createdAt <= lookBack) continue;
    const existing = bySwimmer.get(s.uid);
    if (!existing) {
      bySwimmer.set(s.uid, {
        kind: "swims",
        uid: s.uid,
        name: s.displayName,
        count: 1,
        latest: s,
      });
    } else {
      existing.count += 1;
      if (s.createdAt > existing.latest.createdAt) {
        existing.latest = s;
        existing.name = s.displayName;
      }
    }
  }

  const swimItems = [...bySwimmer.values()].toSorted(
    (a, b) => b.count - a.count || b.latest.createdAt - a.latest.createdAt,
  );

  // ── Reactions on your own swims ───────────────────────────────────────
  // Auto: only reactions unseen since the baseline (a true "what's new").
  // Manual: reactions on any swim within the window, counted in full — a
  // recap of the love your recent dips have collected.
  const reactionItems: AwayReactions[] = [];
  for (const s of mySessions) {
    const total = reactionTotal(s);
    if (total === 0) continue;
    let newCount: number;
    if (manual) {
      if (s.date <= lookBack) continue; // only swims within the window
      newCount = total;
    } else {
      // Unknown baseline (never recorded this swim) counts as "already seen"
      // so we never dump a swim's whole reaction history into the first digest.
      const seen = reactionBaseline[s.id] ?? total;
      newCount = total - seen;
    }
    if (newCount > 0)
      reactionItems.push({
        kind: "reactions",
        session: s,
        newCount,
        emojis: topEmojis(s),
      });
  }
  reactionItems.sort(
    (a, b) => b.newCount - a.newCount || b.session.date - a.session.date,
  );

  // Reactions are about *you*, so they lead; swims follow.
  const items: AwayItem[] = [...reactionItems, ...swimItems].slice(
    0,
    MAX_ITEMS,
  );
  if (items.length === 0 && !manual) return null;

  return {
    since: lookBack,
    items,
    swimmerCount: swimItems.length,
    totalSwims: swimItems.reduce((n, i) => n + i.count, 0),
    reactionCount: reactionItems.reduce((n, i) => n + i.newCount, 0),
  };
}

// ── Reaction baseline persistence (per device, per user) ────────────────

const reactionKey = (uid: string) => `badligan.reactionSeen.${uid}`;

/** Load the per-session reactor counts we last surfaced on this device. */
export function loadReactionBaseline(uid: string): Record<string, number> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(reactionKey(uid));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Snapshot the current reactor counts for the user's swims as "seen". */
export function saveReactionBaseline(
  uid: string,
  mySessions: SessionDoc[],
): void {
  if (typeof localStorage === "undefined") return;
  const snapshot: Record<string, number> = {};
  for (const s of mySessions) snapshot[s.id] = reactionTotal(s);
  try {
    localStorage.setItem(reactionKey(uid), JSON.stringify(snapshot));
  } catch {
    /* quota / private mode — the digest just won't track reactions */
  }
}
