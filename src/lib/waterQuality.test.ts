import { describe, it, expect } from "vitest";
import {
  sampleSeverity,
  algaeSeverity,
  isSampleFresh,
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
    expect(algaeSeverity(undefined)).toBe("muted");
  });
});

describe("isSampleFresh", () => {
  const now = 1_752_000_000_000;
  const day = 24 * 60 * 60 * 1000;

  it("shows samples up to the ~2 week window", () => {
    expect(isSampleFresh(now - 9 * day, now)).toBe(true); // e.g. Sörvik
    expect(isSampleFresh(now - 13 * day, now)).toBe(true);
    expect(isSampleFresh(now - (SAMPLE_FRESH_MS + day), now)).toBe(false);
    expect(isSampleFresh(undefined, now)).toBe(false);
  });
});
