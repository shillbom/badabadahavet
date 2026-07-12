import { describe, it, expect } from "vitest";
import {
  asReading,
  freshestReading,
  readingFromLegacyPlace,
  buildSummaryEntries,
  summaryChanged,
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
