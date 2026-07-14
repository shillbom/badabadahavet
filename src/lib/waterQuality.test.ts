import { describe, it, expect } from "vitest";
import {
  sampleSeverity,
  algaeSeverity,
  classSeverity,
  isSampleFresh,
  visibleAdvisories,
  hasDisplayableQuality,
  SAMPLE_FRESH_MS,
} from "./waterQuality";

describe("severity maps", () => {
  it("sampleSeverity", () => {
    expect(sampleSeverity(1)).toBe("ok");
    expect(sampleSeverity(2)).toBe("warn");
    expect(sampleSeverity(3)).toBe("bad");
    expect(sampleSeverity(4)).toBe("muted");
    expect(sampleSeverity(undefined)).toBe("muted");
  });

  it("algaeSeverity", () => {
    expect(algaeSeverity(3)).toBe("bad");
    expect(algaeSeverity(4)).toBe("ok");
    expect(algaeSeverity(5)).toBe("muted");
  });

  it("classSeverity", () => {
    expect(classSeverity(1)).toBe("ok");
    expect(classSeverity(2)).toBe("ok");
    expect(classSeverity(3)).toBe("warn");
    expect(classSeverity(4)).toBe("bad");
    expect(classSeverity(0)).toBe("muted");
    expect(classSeverity(6)).toBe("muted");
  });
});

describe("freshness", () => {
  const now = 1_752_000_000_000;
  const day = 24 * 60 * 60 * 1000;

  it("isSampleFresh gates on the season window", () => {
    expect(isSampleFresh(now - 10 * day, now)).toBe(true);
    expect(isSampleFresh(now - (SAMPLE_FRESH_MS + day), now)).toBe(false);
    expect(isSampleFresh(undefined, now)).toBe(false);
  });

  it("visibleAdvisories drops aged-out entries", () => {
    const wq = {
      advisories: [
        { type: 1, at: now - 5 * day },
        { type: 99, at: now - 400 * day },
      ],
    };
    expect(visibleAdvisories(wq, now)).toEqual([
      { type: 1, at: now - 5 * day },
    ]);
    expect(visibleAdvisories(undefined, now)).toEqual([]);
    expect(visibleAdvisories({}, now)).toEqual([]);
  });
});

describe("hasDisplayableQuality", () => {
  const now = 1_752_000_000_000;
  const day = 24 * 60 * 60 * 1000;

  it("true for a current advisory", () => {
    expect(
      hasDisplayableQuality({ advisories: [{ type: 1, at: now - day }] }, now),
    ).toBe(true);
  });

  it("true for a fresh sample, false when stale", () => {
    expect(
      hasDisplayableQuality({ sampleValue: 1, sampleAt: now - day }, now),
    ).toBe(true);
    expect(
      hasDisplayableQuality({ sampleValue: 1, sampleAt: now - 400 * day }, now),
    ).toBe(false);
  });

  it("true for a real EU classification, false otherwise", () => {
    expect(hasDisplayableQuality({ classification: 4 }, now)).toBe(true);
    expect(hasDisplayableQuality({ classification: 0 }, now)).toBe(false);
    expect(hasDisplayableQuality({ classification: 6 }, now)).toBe(false);
    expect(hasDisplayableQuality(undefined, now)).toBe(false);
    expect(hasDisplayableQuality({}, now)).toBe(false);
  });
});
