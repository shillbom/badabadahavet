import { describe, it, expect } from "vitest";
import {
  buildPlacesSummaryEntries,
  placesSummaryChanged,
} from "./placesLogic.js";

const place = (id, over = {}) => ({
  id,
  name: `Place ${id}`,
  lat: 59 + Number(id) / 100,
  lng: 18 + Number(id) / 100,
  ...over,
});

describe("buildPlacesSummaryEntries", () => {
  it("packs name/lat/lng into terse keys", () => {
    const entries = buildPlacesSummaryEntries([place("1")], new Map());
    expect(entries["1"]).toEqual({ n: "Place 1", la: 59.01, lo: 18.01 });
  });

  it("adds `u` only for naturist spots", () => {
    const entries = buildPlacesSummaryEntries(
      [place("1", { nude: true }), place("2", { nude: false }), place("3")],
      new Map(),
    );
    expect(entries["1"].u).toBe(true);
    expect("u" in entries["2"]).toBe(false);
    expect("u" in entries["3"]).toBe(false);
  });

  it("adds `s`/`b` from the last-swim lookup, omitting `b` when none", () => {
    const lastSwim = new Map([
      ["1", { at: 1000, border: "gold" }],
      ["2", { at: 2000, border: "none" }],
      ["3", { at: 3000 }],
    ]);
    const entries = buildPlacesSummaryEntries(
      [place("1"), place("2"), place("3")],
      lastSwim,
    );
    expect(entries["1"].s).toBe(1000);
    expect(entries["1"].b).toBe("gold");
    expect(entries["2"].s).toBe(2000);
    expect("b" in entries["2"]).toBe(false);
    expect(entries["3"].s).toBe(3000);
    expect("b" in entries["3"]).toBe(false);
  });

  it("accepts a plain object lookup as well as a Map", () => {
    const entries = buildPlacesSummaryEntries([place("1")], {
      1: { at: 42, border: "silver" },
    });
    expect(entries["1"].s).toBe(42);
    expect(entries["1"].b).toBe("silver");
  });

  it("drops places without a name or valid coordinates", () => {
    const entries = buildPlacesSummaryEntries(
      [
        place("1"),
        { id: "2", name: "", lat: 1, lng: 2 },
        { id: "3", name: "No coords" },
        { id: "4", name: "Bad lat", lat: "x", lng: 2 },
      ],
      new Map(),
    );
    expect(Object.keys(entries)).toEqual(["1"]);
  });
});

describe("placesSummaryChanged", () => {
  const built = (over) =>
    buildPlacesSummaryEntries(
      [place("1", over?.p1), place("2", over?.p2)],
      over?.last ?? new Map(),
    );

  it("is false for identical maps", () => {
    expect(placesSummaryChanged(built(), built())).toBe(false);
  });

  it("detects an added or removed place", () => {
    const one = buildPlacesSummaryEntries([place("1")], new Map());
    const two = buildPlacesSummaryEntries([place("1"), place("2")], new Map());
    expect(placesSummaryChanged(one, two)).toBe(true);
    expect(placesSummaryChanged(two, one)).toBe(true);
  });

  it("detects a renamed place", () => {
    expect(
      placesSummaryChanged(built(), built({ p1: { name: "Renamed" } })),
    ).toBe(true);
  });

  it("detects a toggled naturist flag", () => {
    expect(placesSummaryChanged(built(), built({ p1: { nude: true } }))).toBe(
      true,
    );
  });

  it("detects a changed last swim", () => {
    const before = built({ last: new Map([["1", { at: 1000 }]]) });
    const after = built({ last: new Map([["1", { at: 2000 }]]) });
    expect(placesSummaryChanged(before, after)).toBe(true);
  });

  it("tolerates null/undefined sides", () => {
    expect(placesSummaryChanged(null, {})).toBe(false);
    expect(placesSummaryChanged(undefined, built())).toBe(true);
  });
});
