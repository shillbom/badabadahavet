import { describe, it, expect } from "vitest";
import {
  isWinterMonth,
  isHomeSwim,
  scoreSession,
  previewPoints,
  sumScores,
  POINTS_PER_SWIM,
  POINTS_NEW_SPOT,
  POINTS_WINTER,
} from "./scoring";

// Mid-month local dates so timezone never flips the month.
const onMonth = (m: number) => new Date(2026, m, 15, 12).getTime();

describe("isWinterMonth", () => {
  it("is true Nov–Mar", () => {
    for (const m of [10, 11, 0, 1, 2])
      expect(isWinterMonth(onMonth(m))).toBe(true);
  });
  it("is false Apr–Oct", () => {
    for (const m of [3, 4, 5, 6, 7, 8, 9])
      expect(isWinterMonth(onMonth(m))).toBe(false);
  });
});

describe("isHomeSwim", () => {
  it("matches home country", () => {
    expect(isHomeSwim("SE", "SE")).toBe(true);
    expect(isHomeSwim("SE", "NO")).toBe(false);
    expect(isHomeSwim("OTHER", "SE")).toBe(false);
    expect(isHomeSwim(null, "SE")).toBe(false);
    expect(isHomeSwim("SE", null)).toBe(false);
  });
});

describe("scoreSession", () => {
  it("awards 1 for a plain summer swim", () => {
    const r = scoreSession({ isUniqueForUser: false, date: onMonth(6) });
    expect(r.points).toBe(POINTS_PER_SWIM);
    expect(r.isWinter).toBe(false);
  });
  it("adds the new-spot bonus", () => {
    const r = scoreSession({ isUniqueForUser: true, date: onMonth(6) });
    expect(r.points).toBe(POINTS_PER_SWIM + POINTS_NEW_SPOT);
  });
  it("adds the winter bonus", () => {
    const r = scoreSession({ isUniqueForUser: false, date: onMonth(0) });
    expect(r.points).toBe(POINTS_PER_SWIM + POINTS_WINTER);
    expect(r.isWinter).toBe(true);
  });
  it("stacks new-spot + winter", () => {
    const r = scoreSession({ isUniqueForUser: true, date: onMonth(11) });
    expect(r.points).toBe(POINTS_PER_SWIM + POINTS_NEW_SPOT + POINTS_WINTER);
  });
  it("flags home country", () => {
    const home = scoreSession({
      isUniqueForUser: false,
      date: onMonth(6),
      country: "SE",
      homeCountry: "SE",
    });
    expect(home.isHomeCountry).toBe(true);
    const abroad = scoreSession({
      isUniqueForUser: false,
      date: onMonth(6),
      country: "NO",
      homeCountry: "SE",
    });
    expect(abroad.isHomeCountry).toBe(false);
  });
});

describe("previewPoints", () => {
  it("matches scoreSession's arithmetic", () => {
    expect(previewPoints({ isNewSpot: false, isWinter: false })).toBe(1);
    expect(previewPoints({ isNewSpot: true, isWinter: false })).toBe(4);
    expect(previewPoints({ isNewSpot: true, isWinter: true })).toBe(6);
  });
});

describe("sumScores", () => {
  it("sums per-year totals", () => {
    expect(sumScores({ "2025": 5, "2026": 3 })).toBe(8);
  });
  it("treats missing as zero", () => {
    expect(sumScores(undefined)).toBe(0);
    expect(sumScores({})).toBe(0);
  });
});
