import { describe, expect, it } from "vitest";
import { splitTopList } from "./leaderboard";

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
