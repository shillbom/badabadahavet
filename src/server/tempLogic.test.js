import { describe, it, expect } from "vitest";
import {
  asReading,
  freshestReading,
  readingFromLegacyPlace,
  buildSummaryEntries,
  summaryChanged,
  extractWaterSample,
  qualityMapChanged,
} from "./tempLogic.js";

const reading = (at, t = 17.5, p = "smhi") => ({ t, at, p });

describe("asReading", () => {
  it("accepts a complete reading and returns the same object", () => {
    const r = reading(1000);
    expect(asReading(r)).toBe(r);
  });

  it("tolerates extra fields (a placeTemps doc)", () => {
    const doc = { placeId: "abc", checkedAt: 2000, ...reading(1000) };
    expect(asReading(doc)).toBe(doc);
  });

  it("rejects null, missing and malformed fields", () => {
    expect(asReading(null)).toBeNull();
    expect(asReading(undefined)).toBeNull();
    expect(asReading({ placeId: "abc", checkedAt: 2000 })).toBeNull();
    expect(asReading({ t: 17, at: NaN, p: "smhi" })).toBeNull();
    expect(asReading({ t: "17", at: 1000, p: "smhi" })).toBeNull();
    expect(asReading({ t: 17, at: 1000 })).toBeNull();
  });
});

describe("freshestReading", () => {
  it("picks the more recently sampled reading", () => {
    const older = reading(1000);
    const newer = reading(2000);
    expect(freshestReading(older, newer)).toBe(newer);
    expect(freshestReading(newer, older)).toBe(newer);
  });

  it("handles missing sides", () => {
    const r = reading(1000);
    expect(freshestReading(r, null)).toBe(r);
    expect(freshestReading(null, r)).toBe(r);
    expect(freshestReading(null, undefined)).toBeNull();
  });

  it("keeps the first argument on a tie", () => {
    const a = reading(1000);
    const b = reading(1000);
    expect(freshestReading(a, b)).toBe(a);
  });

  it("ignores an invalid reading on either side", () => {
    const r = reading(1000);
    expect(freshestReading({ t: 17 }, r)).toBe(r);
    expect(freshestReading(r, { placeId: "x", checkedAt: 5000 })).toBe(r);
  });
});

describe("readingFromLegacyPlace", () => {
  it("converts legacy place fields", () => {
    expect(
      readingFromLegacyPlace({
        waterTemp: 14.2,
        waterTempAt: 1234,
        waterTempProvider: "havochvatten",
      }),
    ).toEqual({ t: 14.2, at: 1234, p: "havochvatten" });
  });

  it("defaults a missing provider to open-meteo", () => {
    expect(
      readingFromLegacyPlace({ waterTemp: 14.2, waterTempAt: 1234 }),
    ).toEqual({ t: 14.2, at: 1234, p: "open-meteo" });
  });

  it("returns null when the place never had a reading", () => {
    expect(readingFromLegacyPlace({ name: "Kallbadhuset" })).toBeNull();
    expect(readingFromLegacyPlace(null)).toBeNull();
    expect(readingFromLegacyPlace({ waterTemp: 14.2 })).toBeNull();
  });
});

describe("buildSummaryEntries", () => {
  it("builds entries from a Map, dropping nulls and extra fields", () => {
    const m = new Map([
      ["a", { placeId: "a", checkedAt: 9, ...reading(1000) }],
      ["b", null],
      ["c", reading(2000, 3.1, "open-meteo")],
    ]);
    expect(buildSummaryEntries(m)).toEqual({
      a: { t: 17.5, at: 1000, p: "smhi" },
      c: { t: 3.1, at: 2000, p: "open-meteo" },
    });
  });

  it("accepts a plain object and drops invalid readings", () => {
    expect(
      buildSummaryEntries({ a: reading(1000), b: { checkedAt: 5 } }),
    ).toEqual({ a: { t: 17.5, at: 1000, p: "smhi" } });
  });
});

describe("summaryChanged", () => {
  const entries = { a: reading(1000), b: reading(2000, 8, "open-meteo") };

  it("false for identical content", () => {
    expect(
      summaryChanged(entries, {
        a: reading(1000),
        b: reading(2000, 8, "open-meteo"),
      }),
    ).toBe(false);
  });

  it("true when a value, key, or count differs", () => {
    expect(summaryChanged(entries, { ...entries, a: reading(1001) })).toBe(
      true,
    );
    expect(summaryChanged(entries, { a: entries.a })).toBe(true);
    expect(summaryChanged(entries, { a: entries.a, c: entries.b })).toBe(true);
    expect(summaryChanged(entries, { ...entries, c: reading(3) })).toBe(true);
  });

  it("treats null/undefined as empty", () => {
    expect(summaryChanged(null, {})).toBe(false);
    expect(summaryChanged(undefined, entries)).toBe(true);
  });
});

describe("extractWaterSample", () => {
  const day = 24 * 60 * 60 * 1000;
  const base = 1_752_000_000_000;

  it("takes the newest sample by date (ignores ordering)", () => {
    const body = {
      // top-level mirrors the newest sample
      sampleValue: 3,
      algalValue: 3,
      sampleDate: base,
      testResult: [
        { sampleDate: base - 40 * day, sampleValue: 1, algalValue: 4 },
        { sampleDate: base, sampleValue: 3, algalValue: 3 },
      ],
    };
    expect(extractWaterSample(body)).toEqual({ v: 3, a: 3, at: base });
  });

  it("falls back to top-level fields when testResult is absent", () => {
    expect(
      extractWaterSample({ sampleValue: 1, algalValue: 4, sampleDate: base }),
    ).toEqual({ v: 1, a: 4, at: base });
  });

  it("keeps a partial sample (verdict but no algae)", () => {
    expect(extractWaterSample({ sampleValue: 2, sampleDate: base })).toEqual({
      v: 2,
      at: base,
    });
  });

  it("returns null without a date or without verdict/algae", () => {
    expect(extractWaterSample({})).toBeNull();
    expect(extractWaterSample(null)).toBeNull();
    expect(extractWaterSample({ sampleValue: 1 })).toBeNull(); // no date
    expect(extractWaterSample({ sampleDate: base })).toBeNull(); // no v/a
  });
});

describe("qualityMapChanged", () => {
  const map = () => ({
    a: { v: 1, a: 4, at: 1000 },
    b: { v: 3, a: 3, at: 2000 },
  });

  it("false for identical content and both-empty", () => {
    expect(qualityMapChanged(map(), map())).toBe(false);
    expect(qualityMapChanged(null, {})).toBe(false);
  });

  it("true when a value, key, or count differs", () => {
    expect(
      qualityMapChanged(map(), { ...map(), a: { v: 1, a: 4, at: 1001 } }),
    ).toBe(true);
    expect(qualityMapChanged(map(), { a: map().a })).toBe(true);
    expect(qualityMapChanged(map(), { a: map().a, c: map().b })).toBe(true);
    expect(qualityMapChanged(undefined, map())).toBe(true);
  });
});
