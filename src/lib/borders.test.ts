import { describe, it, expect } from "vitest";
import {
  tierForCount,
  nextTier,
  isBorderUnlocked,
  resolveBorder,
  pinRingFor,
  borderById,
  BORDERS,
} from "./borders";

describe("tierForCount", () => {
  it("steps through the ladder", () => {
    expect(tierForCount(0).id).toBe("none");
    expect(tierForCount(1).id).toBe("bronze");
    expect(tierForCount(3).id).toBe("bronze");
    expect(tierForCount(4).id).toBe("silver");
    expect(tierForCount(8).id).toBe("gold");
    expect(tierForCount(11).id).toBe("gold");
    expect(tierForCount(12).id).toBe("diamond");
    expect(tierForCount(99).id).toBe("diamond");
  });
});

describe("nextTier", () => {
  it("reports the next rung + how far", () => {
    expect(nextTier(0)).toEqual({
      border: expect.objectContaining({ id: "bronze" }),
      remaining: 1,
    });
    expect(nextTier(2)?.border.id).toBe("silver");
    expect(nextTier(2)?.remaining).toBe(2);
  });
  it("is null at the top", () => {
    expect(nextTier(12)).toBeNull();
  });
});

describe("isBorderUnlocked", () => {
  it("count-gated borders need the count", () => {
    const gold = borderById("gold")!;
    expect(isBorderUnlocked(gold, 7, new Set())).toBe(false);
    expect(isBorderUnlocked(gold, 8, new Set())).toBe(true);
  });
  it("achievement-gated borders need the achievement", () => {
    const frost = borderById("frost")!;
    expect(isBorderUnlocked(frost, 99, new Set())).toBe(false);
    expect(isBorderUnlocked(frost, 0, new Set(["WINTER_WARRIOR"]))).toBe(true);
  });
  it("none is always unlocked", () => {
    expect(isBorderUnlocked(borderById("none")!, 0, new Set())).toBe(true);
  });
});

describe("resolveBorder", () => {
  it("honours a still-earned pick", () => {
    expect(resolveBorder("silver", 5, new Set()).id).toBe("silver");
  });
  it("falls back to the earned tier when the pick is no longer valid", () => {
    // Picked gold but only 4 achievements → falls back to silver.
    expect(resolveBorder("gold", 4, new Set()).id).toBe("silver");
  });
  it("defaults to the tier when nothing is picked", () => {
    expect(resolveBorder(undefined, 1, new Set()).id).toBe("bronze");
    expect(resolveBorder(null, 0, new Set()).id).toBe("none");
  });
});

describe("pinRingFor", () => {
  it("returns null for none/unknown/empty", () => {
    expect(pinRingFor("none")).toBeNull();
    expect(pinRingFor("bogus")).toBeNull();
    expect(pinRingFor(undefined)).toBeNull();
  });
  it("returns ring colours for a real border", () => {
    const ring = pinRingFor("gold");
    expect(ring).not.toBeNull();
    expect(ring!.id).toBe("gold");
    expect(typeof ring!.ring).toBe("string");
    expect(typeof ring!.glow).toBe("string");
  });
});

describe("catalog", () => {
  it("has unique ids", () => {
    const ids = BORDERS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
