import { describe, expect, it } from "vitest";
import { splitTopList, yearPickerBounds } from "./leaderboard";
import { FIRST_YEAR } from "./scoring";

const rows = ["a", "b", "c", "d", "e", "f", "g"].map((uid) => ({ uid }));

describe("splitTopList", () => {
  it("returns only the top N when I'm inside it", () => {
    const { top, me } = splitTopList(rows, "c", 5);
    expect(top.map((r) => r.uid)).toEqual(["a", "b", "c", "d", "e"]);
    expect(me).toBeNull();
  });

  it("appends my row with its true rank when I'm below the cut", () => {
    const { top, me } = splitTopList(rows, "g", 5);
    expect(top).toHaveLength(5);
    expect(me).toEqual({ row: { uid: "g" }, rank: 6 });
  });

  it("returns no extra row for unranked or signed-out users", () => {
    expect(splitTopList(rows, "nope", 5).me).toBeNull();
    expect(splitTopList(rows, undefined, 5).me).toBeNull();
  });

  it("handles lists shorter than N", () => {
    const short = rows.slice(0, 3);
    const { top, me } = splitTopList(short, "b", 5);
    expect(top).toHaveLength(3);
    expect(me).toBeNull();
  });
});

describe("yearPickerBounds", () => {
  it("locks the floor to the first season and the ceiling to now", () => {
    const b = yearPickerBounds(FIRST_YEAR + 1, FIRST_YEAR + 2);
    expect(b.min).toBe(FIRST_YEAR);
    expect(b.max).toBe(FIRST_YEAR + 2);
    expect(b.canGoBack).toBe(true);
    expect(b.canGoForward).toBe(true);
  });

  it("disables both arrows in the very first season (nothing to page to)", () => {
    const b = yearPickerBounds(FIRST_YEAR, FIRST_YEAR);
    expect(b.min).toBe(FIRST_YEAR);
    expect(b.max).toBe(FIRST_YEAR);
    expect(b.canGoBack).toBe(false);
    expect(b.canGoForward).toBe(false);
  });

  it("can page back from the current season but not into the future", () => {
    const b = yearPickerBounds(FIRST_YEAR + 3, FIRST_YEAR + 3);
    expect(b.canGoBack).toBe(true);
    expect(b.canGoForward).toBe(false);
  });

  it("never lets the ceiling fall below the first season", () => {
    // Defensive: a clock reporting a pre-launch year still floors at FIRST_YEAR.
    const b = yearPickerBounds(FIRST_YEAR, FIRST_YEAR - 5);
    expect(b.max).toBe(FIRST_YEAR);
    expect(b.canGoForward).toBe(false);
  });
});
