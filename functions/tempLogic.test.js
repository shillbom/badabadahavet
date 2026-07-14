import { describe, it, expect } from "vitest";
import {
  asReading,
  freshestReading,
  readingFromLegacyPlace,
  buildSummaryEntries,
  summaryChanged,
  extractWaterQuality,
  waterQualityChanged,
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

describe("extractWaterQuality", () => {
  // Times relative to a fixed "now" so the advisory recency filter is
  // deterministic. 2026-07-14-ish.
  const now = 1_752_000_000_000;
  const day = 24 * 60 * 60 * 1000;

  it("takes the newest sample and copies classification", () => {
    // Two samples out of order — the newer one (algae bloom) must win.
    const body = {
      algalValue: 4,
      sampleValue: 1,
      sampleDate: now - 5 * day,
      classification: 1,
      classificationYear: 2025,
      dissuasion: [],
      testResult: [
        { sampleDate: now - 40 * day, sampleValue: 1, algalValue: 4 },
        { sampleDate: now - 5 * day, sampleValue: 3, algalValue: 3 },
      ],
    };
    expect(extractWaterQuality(body, now)).toEqual({
      sampleValue: 3,
      sampleAt: now - 5 * day,
      algae: 3,
      classification: 1,
      classificationYear: 2025,
    });
  });

  it("falls back to top-level fields when testResult is absent", () => {
    const body = {
      algalValue: 5,
      sampleValue: 1,
      sampleDate: now - 2 * day,
      classification: 0,
    };
    expect(extractWaterQuality(body, now)).toEqual({
      sampleValue: 1,
      sampleAt: now - 2 * day,
      algae: 5,
      classification: 0,
    });
  });

  it("keeps current advisories and drops stale ones", () => {
    const body = {
      dissuasion: [
        // ~2 years old — HaV never removed it; must be dropped.
        { type: 1, startdate: now - 700 * day, description: "Gammalt prov" },
        // current season
        {
          type: 99,
          startdate: now - 20 * day,
          description: "Dålig badvattenkvalitet",
        },
        {
          type: 1,
          startdate: now - 3 * day,
          description: "Höga halter E.coli",
        },
      ],
    };
    const wq = extractWaterQuality(body, now);
    expect(wq.advisories).toEqual([
      { type: 1, at: now - 3 * day, text: "Höga halter E.coli" },
      { type: 99, at: now - 20 * day, text: "Dålig badvattenkvalitet" },
    ]);
  });

  it("returns null when nothing useful is present", () => {
    expect(extractWaterQuality({}, now)).toBeNull();
    expect(extractWaterQuality(null, now)).toBeNull();
    expect(
      extractWaterQuality(
        { dissuasion: [{ type: 1, startdate: now - 700 * day }] },
        now,
      ),
    ).toBeNull();
  });
});

describe("waterQualityChanged", () => {
  const wq = () => ({
    sampleValue: 1,
    sampleAt: 1000,
    algae: 4,
    classification: 1,
    classificationYear: 2025,
    advisories: [{ type: 1, at: 900, text: "x" }],
  });

  it("false for equal snapshots and for both-empty", () => {
    expect(waterQualityChanged(wq(), wq())).toBe(false);
    expect(waterQualityChanged(null, undefined)).toBe(false);
  });

  it("true when one side is missing", () => {
    expect(waterQualityChanged(wq(), null)).toBe(true);
    expect(waterQualityChanged(null, wq())).toBe(true);
  });

  it("true on a scalar or advisory difference", () => {
    expect(waterQualityChanged(wq(), { ...wq(), algae: 3 })).toBe(true);
    expect(waterQualityChanged(wq(), { ...wq(), advisories: [] })).toBe(true);
    expect(
      waterQualityChanged(wq(), {
        ...wq(),
        advisories: [{ type: 1, at: 901, text: "x" }],
      }),
    ).toBe(true);
  });
});
