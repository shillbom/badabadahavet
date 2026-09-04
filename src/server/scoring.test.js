import { describe, it, expect } from "vitest";
import {
  swimYear,
  isWinterMonth,
  yearBounds,
  swimPoints,
  sumYearPoints,
  yearStats,
  POINTS_PER_SWIM,
  POINTS_NEW_SPOT,
  POINTS_WINTER,
} from "./scoring.js";

describe("swimYear (UTC)", () => {
  it("buckets by UTC year", () => {
    expect(swimYear(Date.UTC(2026, 5, 1, 12))).toBe(2026);
    // New Year's Eve 23:00 UTC is still 2025.
    expect(swimYear(Date.UTC(2025, 11, 31, 23))).toBe(2025);
  });
});

describe("isWinterMonth (UTC)", () => {
  it("is true Nov–Mar, false otherwise", () => {
    for (const m of [10, 11, 0, 1, 2])
      expect(isWinterMonth(Date.UTC(2026, m, 15, 12))).toBe(true);
    for (const m of [3, 4, 5, 6, 7, 8, 9])
      expect(isWinterMonth(Date.UTC(2026, m, 15, 12))).toBe(false);
  });
});

describe("yearBounds", () => {
  it("returns [Jan 1 UTC, next Jan 1 UTC)", () => {
    const [start, end] = yearBounds(2026);
    expect(start).toBe(Date.UTC(2026, 0, 1));
    expect(end).toBe(Date.UTC(2027, 0, 1));
    expect(end - start).toBe(365 * 86_400_000); // 2026 is not a leap year
  });
});

describe("swimPoints", () => {
  it("matches the +1 / +3 / +2 rules", () => {
    expect(swimPoints(false, false)).toBe(POINTS_PER_SWIM);
    expect(swimPoints(true, false)).toBe(POINTS_PER_SWIM + POINTS_NEW_SPOT);
    expect(swimPoints(false, true)).toBe(POINTS_PER_SWIM + POINTS_WINTER);
    expect(swimPoints(true, true)).toBe(
      POINTS_PER_SWIM + POINTS_NEW_SPOT + POINTS_WINTER,
    );
  });
});

describe("sumYearPoints", () => {
  // Minimal Firestore-QuerySnapshot stub.
  const snap = (docs) => ({
    forEach: (fn) => docs.forEach(fn),
  });
  const doc = (id, points) => ({ id, data: () => ({ points }) });

  it("sums all points", () => {
    expect(sumYearPoints(snap([doc("a", 1), doc("b", 3), doc("c", 2)]))).toBe(
      6,
    );
  });
  it("excludes one doc (used when removing a session)", () => {
    expect(
      sumYearPoints(snap([doc("a", 1), doc("b", 3), doc("c", 2)]), "b"),
    ).toBe(3);
  });
  it("ignores non-numeric points and is 0 for empty", () => {
    expect(sumYearPoints(snap([]))).toBe(0);
    expect(sumYearPoints(snap([doc("a", undefined), doc("b", 2)]))).toBe(2);
  });
});

describe("yearStats", () => {
  const snap = (docs) => ({
    forEach: (fn) => docs.forEach(fn),
  });
  const doc = (id, s) => ({ id, data: () => s });
  const swim = (over = {}) => ({
    isUniqueForUser: false,
    isWinter: false,
    isHomeCountry: true,
    ...over,
  });

  it("counts swims, new spots, winters, and distinct countries abroad", () => {
    const stats = yearStats(
      snap([
        doc("a", swim({ isUniqueForUser: true })),
        doc("b", swim({ isWinter: true })),
        doc("c", swim({ isHomeCountry: false, country: "NO" })),
        doc("d", swim({ isHomeCountry: false, country: "NO" })),
        doc("e", swim({ isHomeCountry: false, country: "DK" })),
      ]),
    );
    expect(stats).toEqual({
      swims: 5,
      uniquePlaces: 1,
      winters: 1,
      countriesAbroad: 2,
    });
  });

  it("does not count home-country or country-less swims as abroad", () => {
    const stats = yearStats(
      snap([
        doc("a", swim({ isHomeCountry: true, country: "SE" })),
        doc("b", swim({ isHomeCountry: false })),
      ]),
    );
    expect(stats.countriesAbroad).toBe(0);
  });

  it("excludes one doc (removal)", () => {
    const stats = yearStats(
      snap([
        doc("a", swim({ isUniqueForUser: true, isWinter: true })),
        doc("b", swim()),
      ]),
      { excludeId: "a" },
    );
    expect(stats).toEqual({
      swims: 1,
      uniquePlaces: 0,
      winters: 0,
      countriesAbroad: 0,
    });
  });

  it("folds in an unwritten extra session (creation)", () => {
    const stats = yearStats(snap([doc("a", swim())]), {
      extra: swim({
        isUniqueForUser: true,
        isHomeCountry: false,
        country: "FI",
      }),
    });
    expect(stats).toEqual({
      swims: 2,
      uniquePlaces: 1,
      winters: 0,
      countriesAbroad: 1,
    });
  });

  it("is all zeroes for an empty year", () => {
    expect(yearStats(snap([]))).toEqual({
      swims: 0,
      uniquePlaces: 0,
      winters: 0,
      countriesAbroad: 0,
    });
  });
});
