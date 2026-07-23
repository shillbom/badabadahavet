import { describe, it, expect } from "vitest";
import { DAY_MS, groupRangeMs, formatGroupRange } from "./date";

describe("groupRangeMs", () => {
  it("is fully open when no bounds are set", () => {
    expect(groupRangeMs({})).toEqual({
      startMs: 0,
      endExclusiveMs: Infinity,
    });
  });

  it("treats endDate as the last included day (exclusive next midnight)", () => {
    const start = new Date(2026, 5, 1).getTime();
    const end = new Date(2026, 7, 31).getTime();
    expect(groupRangeMs({ startDate: start, endDate: end })).toEqual({
      startMs: start,
      endExclusiveMs: end + DAY_MS,
    });
  });

  it("supports open-ended ranges on either side", () => {
    const start = new Date(2026, 5, 1).getTime();
    expect(groupRangeMs({ startDate: start })).toEqual({
      startMs: start,
      endExclusiveMs: Infinity,
    });
    const end = new Date(2026, 7, 31).getTime();
    expect(groupRangeMs({ endDate: end })).toEqual({
      startMs: 0,
      endExclusiveMs: end + DAY_MS,
    });
  });
});

describe("formatGroupRange", () => {
  const labels = { openStart: "Until", openEnd: "From" };
  const start = new Date(2026, 5, 1).getTime();
  const end = new Date(2026, 7, 31).getTime();

  it("returns null when there is no timespan", () => {
    expect(formatGroupRange({}, "en-GB", labels)).toBeNull();
  });

  it("joins both bounds with a dash", () => {
    const out = formatGroupRange(
      { startDate: start, endDate: end },
      "en-GB",
      labels,
    );
    expect(out).toContain("–");
    expect(out).toContain("2026");
  });

  it("prefixes open-ended ranges", () => {
    expect(formatGroupRange({ startDate: start }, "en-GB", labels)).toMatch(
      /^From /,
    );
    expect(formatGroupRange({ endDate: end }, "en-GB", labels)).toMatch(
      /^Until /,
    );
  });
});
