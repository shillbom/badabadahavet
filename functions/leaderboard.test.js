import { describe, it, expect } from "vitest";
import {
  LEADERBOARD_TOP_N,
  leaderboardEntry,
  applyToTop,
  removeFromTop,
} from "./leaderboard.js";

const stats = { swims: 1, uniquePlaces: 1, winters: 0, countriesAbroad: 0 };

describe("leaderboardEntry", () => {
  it("builds a lean entry, omitting absent optionals", () => {
    const e = leaderboardEntry("u1", { displayName: "Ada" }, 10, stats);
    expect(e).toEqual({ uid: "u1", displayName: "Ada", points: 10, stats });
    expect("selectedBorder" in e).toBe(false);
    expect("achievements" in e).toBe(false);
  });

  it("carries border + achievements when present", () => {
    const e = leaderboardEntry(
      "u1",
      { displayName: "Ada", selectedBorder: "gold", achievements: { a: 1 } },
      10,
      stats,
    );
    expect(e.selectedBorder).toBe("gold");
    expect(e.achievements).toEqual({ a: 1 });
  });

  it("falls back to a default name and null stats", () => {
    const e = leaderboardEntry("u1", {}, 3, undefined);
    expect(e.displayName).toBe("Swimmer");
    expect(e.stats).toBe(null);
  });
});

describe("applyToTop", () => {
  const entry = (uid, points) => ({ uid, points, displayName: uid });

  it("inserts into an empty list", () => {
    expect(applyToTop([], entry("a", 5))).toEqual([entry("a", 5)]);
  });

  it("sorts by points desc, uid asc tie-break", () => {
    const top = applyToTop(
      [entry("a", 5), entry("b", 5), entry("c", 9)],
      entry("d", 5),
    );
    expect(top.map((e) => e.uid)).toEqual(["c", "a", "b", "d"]);
  });

  it("replaces an existing entry for the same uid", () => {
    const top = applyToTop([entry("a", 5), entry("b", 3)], entry("a", 1));
    expect(top).toEqual([entry("b", 3), entry("a", 1)]);
  });

  it("keeps only the top N", () => {
    let top = [];
    for (let i = 0; i < 8; i++) top = applyToTop(top, entry(`u${i}`, i));
    expect(top).toHaveLength(LEADERBOARD_TOP_N);
    expect(top.map((e) => e.uid)).toEqual(["u7", "u6", "u5", "u4", "u3"]);
  });

  it("drops a swimmer whose score falls to zero", () => {
    const top = applyToTop([entry("a", 5), entry("b", 3)], entry("b", 0));
    expect(top.map((e) => e.uid)).toEqual(["a"]);
  });

  it("does not add a brand-new zero-point swimmer", () => {
    expect(applyToTop([entry("a", 5)], entry("z", 0))).toEqual([entry("a", 5)]);
  });

  it("tolerates a missing/invalid current list", () => {
    expect(applyToTop(undefined, entry("a", 5))).toEqual([entry("a", 5)]);
    expect(applyToTop(null, entry("a", 5))).toEqual([entry("a", 5)]);
  });
});

describe("removeFromTop", () => {
  const entry = (uid, points) => ({ uid, points, displayName: uid });

  it("removes the given uid", () => {
    const top = removeFromTop([entry("a", 5), entry("b", 3)], "a");
    expect(top.map((e) => e.uid)).toEqual(["b"]);
  });

  it("is a no-op when the uid is absent", () => {
    const top = removeFromTop([entry("a", 5)], "zzz");
    expect(top.map((e) => e.uid)).toEqual(["a"]);
  });

  it("tolerates a missing list", () => {
    expect(removeFromTop(undefined, "a")).toEqual([]);
  });
});
