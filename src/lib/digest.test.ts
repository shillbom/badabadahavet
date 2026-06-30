import { describe, it, expect, beforeEach } from "vitest";
import {
  computeWhileAwayDigest,
  reactionTotal,
  loadReactionBaseline,
  saveReactionBaseline,
  MIN_AWAY_MS,
  type DigestInput,
} from "./digest";
import type { GroupDoc, SessionDoc } from "./types";

// The unit-test env is plain node (no DOM), so stub localStorage so the
// reaction-baseline persistence helpers have something to read/write.
const store = new Map<string, string>();
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

let seq = 0;
function s(over: Partial<SessionDoc> & { uid: string }): SessionDoc {
  const id = over.id ?? `s${seq++}`;
  return {
    id,
    displayName: over.displayName ?? "Someone",
    placeId: over.placeId ?? "p1",
    placeName: over.placeName ?? "Lake",
    lat: 0,
    lng: 0,
    date: over.date ?? 0,
    isUniqueForUser: false,
    isWinter: false,
    points: 1,
    createdAt: over.createdAt ?? over.date ?? 0,
    ...over,
  };
}

function group(members: string[]): GroupDoc {
  return {
    id: "g1",
    name: "Crew",
    code: "ABC",
    members,
    createdBy: members[0],
    createdAt: 0,
  };
}

const NOW = 1_000_000_000_000;
const HOUR = 60 * 60 * 1000;

function input(over: Partial<DigestInput>): DigestInput {
  return {
    myUid: "me",
    since: NOW - 24 * HOUR,
    mySessions: [],
    allSessions: [],
    groups: [],
    reactionBaseline: {},
    now: NOW,
    ...over,
  };
}

describe("computeWhileAwayDigest", () => {
  it("returns null on a first-ever visit (no baseline)", () => {
    expect(computeWhileAwayDigest(input({ since: null }))).toBeNull();
  });

  it("returns null for a too-recent reload", () => {
    const d = computeWhileAwayDigest(
      input({
        since: NOW - (MIN_AWAY_MS - 1),
        allSessions: [s({ uid: "anna", createdAt: NOW - 10 })],
      }),
    );
    expect(d).toBeNull();
  });

  it("returns null when nothing happened while away", () => {
    const d = computeWhileAwayDigest(
      input({
        groups: [group(["me", "anna"])],
        // swim happened *before* the baseline
        allSessions: [s({ uid: "anna", createdAt: NOW - 48 * HOUR })],
      }),
    );
    expect(d).toBeNull();
  });

  it("counts each group-mate's swims since the baseline, excluding mine", () => {
    const d = computeWhileAwayDigest(
      input({
        groups: [group(["me", "anna", "bo"])],
        allSessions: [
          s({ uid: "anna", createdAt: NOW - 2 * HOUR }),
          s({ uid: "anna", createdAt: NOW - 1 * HOUR, placeName: "Sea" }),
          s({ uid: "bo", createdAt: NOW - 3 * HOUR }),
          s({ uid: "me", createdAt: NOW - 1 * HOUR }), // mine — ignored
          s({ uid: "anna", createdAt: NOW - 48 * HOUR }), // before baseline
        ],
      }),
    );
    expect(d).not.toBeNull();
    expect(d!.swimmerCount).toBe(2);
    expect(d!.totalSwims).toBe(3);
    const anna = d!.items.find((i) => i.kind === "swims" && i.uid === "anna");
    expect(anna).toBeTruthy();
    if (anna && anna.kind === "swims") {
      expect(anna.count).toBe(2);
      // latest = the most recent of Anna's swims
      expect(anna.latest.placeName).toBe("Sea");
    }
  });

  it("only surfaces swims from your group-mates, never strangers", () => {
    const d = computeWhileAwayDigest(
      input({
        groups: [group(["me", "bo"])],
        allSessions: [
          // stranger (not in any of my groups) with lots of swims — excluded
          s({ uid: "anna", createdAt: NOW - 2 * HOUR }),
          s({ uid: "anna", createdAt: NOW - 1 * HOUR }),
          // group-mate — the only one that should show
          s({ uid: "bo", createdAt: NOW - 3 * HOUR }),
        ],
      }),
    );
    expect(d!.swimmerCount).toBe(1);
    const swimmers = d!.items
      .filter((i) => i.kind === "swims")
      .map((i) => (i.kind === "swims" ? i.uid : ""));
    expect(swimmers).toEqual(["bo"]);
  });

  it("shows no swims when you're in no groups (reactions still work)", () => {
    const d = computeWhileAwayDigest(
      input({
        groups: [],
        allSessions: [
          s({ uid: "anna", createdAt: NOW - 1 * HOUR }),
          s({ uid: "bo", createdAt: NOW - 2 * HOUR }),
        ],
      }),
    );
    expect(d).toBeNull(); // no group-mates → no swims, nothing to show
  });

  it("surfaces new reactions on my swims and leads with them", () => {
    const mine = s({
      id: "mine1",
      uid: "me",
      date: NOW - 5 * HOUR,
      reactions: { "🔥": ["anna", "bo"], "💪": ["cy"] },
    });
    const d = computeWhileAwayDigest(
      input({
        mySessions: [mine],
        reactionBaseline: { mine1: 1 }, // had 1, now 3 → 2 new
        allSessions: [s({ uid: "anna", createdAt: NOW - 1 * HOUR })],
      }),
    );
    expect(d).not.toBeNull();
    expect(d!.reactionCount).toBe(2);
    // reactions lead
    const first = d!.items[0];
    expect(first.kind).toBe("reactions");
    if (first.kind === "reactions") {
      expect(first.newCount).toBe(2);
      expect(first.emojis[0]).toBe("🔥"); // most-reacted first
    }
  });

  it("treats unknown reaction baselines as already-seen", () => {
    const mine = s({
      id: "mine1",
      uid: "me",
      date: NOW - 5 * HOUR,
      reactions: { "🔥": ["anna", "bo"] },
    });
    const d = computeWhileAwayDigest(
      input({
        mySessions: [mine],
        reactionBaseline: {}, // never recorded → no false "new"
      }),
    );
    expect(d).toBeNull();
  });

  it("manual mode looks back a full window and ignores the away guard", () => {
    const d = computeWhileAwayDigest(
      input({
        since: NOW - 60 * 1000, // a quick reload — auto would bail
        manual: true,
        groups: [group(["me", "anna", "bo"])],
        allSessions: [
          s({ uid: "anna", createdAt: NOW - 10 * 24 * HOUR }), // 10 days ago
          s({ uid: "bo", createdAt: NOW - 40 * 24 * HOUR }), // 40 days — too old
        ],
      }),
    );
    expect(d).not.toBeNull();
    expect(d!.swimmerCount).toBe(1);
    expect(d!.items[0].kind === "swims" && d!.items[0].uid).toBe("anna");
  });

  it("manual mode returns an empty digest (not null) when there's nothing", () => {
    const d = computeWhileAwayDigest(input({ manual: true }));
    expect(d).not.toBeNull();
    expect(d!.items).toEqual([]);
  });

  it("manual mode counts full reactions on recent swims, no baseline needed", () => {
    const mine = s({
      id: "mine1",
      uid: "me",
      date: NOW - 3 * 24 * HOUR,
      reactions: { "🔥": ["anna", "bo", "cy"] },
    });
    const d = computeWhileAwayDigest(
      input({ manual: true, mySessions: [mine], reactionBaseline: {} }),
    );
    const first = d!.items[0];
    expect(first.kind).toBe("reactions");
    if (first.kind === "reactions") expect(first.newCount).toBe(3);
  });

  it("caps the number of items", () => {
    const many: SessionDoc[] = [];
    const members = ["me"];
    for (let i = 0; i < 20; i++) {
      members.push(`u${i}`);
      many.push(s({ uid: `u${i}`, createdAt: NOW - (i + 1) * 60 * 1000 }));
    }
    const d = computeWhileAwayDigest(
      input({ groups: [group(members)], allSessions: many }),
    );
    expect(d!.items.length).toBeLessThanOrEqual(8);
  });
});

describe("reactionTotal", () => {
  it("sums reactors across emoji", () => {
    expect(
      reactionTotal(
        s({ uid: "me", reactions: { "🔥": ["a", "b"], "👏": ["c"] } }),
      ),
    ).toBe(3);
    expect(reactionTotal(s({ uid: "me" }))).toBe(0);
  });
});

describe("reaction baseline persistence", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a snapshot of current reactor counts", () => {
    const sessions = [
      s({ id: "a", uid: "me", reactions: { "🔥": ["x", "y"] } }),
      s({ id: "b", uid: "me" }),
    ];
    saveReactionBaseline("me", sessions);
    expect(loadReactionBaseline("me")).toEqual({ a: 2, b: 0 });
  });

  it("returns an empty object when nothing is stored", () => {
    expect(loadReactionBaseline("nobody")).toEqual({});
  });
});
