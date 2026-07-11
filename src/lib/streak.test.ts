import { describe, it, expect } from "vitest";
import {
  computeStreak,
  longestStreakInYear,
  streakLevel,
  streakTier,
} from "./streak";
import { dayStartMs } from "./date";

const DAY = 86_400_000;
// Noon `n` days ago — noon avoids midnight/timezone edge cases in day math.
const daysAgo = (n: number) => {
  const d = new Date(Date.now() - n * DAY);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
};

describe("computeStreak", () => {
  it("returns zeroes for no sessions", () => {
    const st = computeStreak([]);
    expect(st.current).toBe(0);
    expect(st.longest).toBe(0);
    expect(st.skipsAvailable).toBe(0);
    expect(st.atRisk).toBe(false);
    expect(st.dayTypes.size).toBe(0);
  });

  it("today only = 1, not at risk", () => {
    const st = computeStreak([daysAgo(0)]);
    expect(st.current).toBe(1);
    expect(st.swimDays).toBe(1);
    expect(st.atRisk).toBe(false);
    expect(st.currentStart).toBe(dayStartMs(daysAgo(0)));
  });

  it("dedupes multiple swims on the same day", () => {
    const st = computeStreak([daysAgo(0), daysAgo(0), daysAgo(1)]);
    expect(st.current).toBe(2);
    expect(st.swimDays).toBe(2);
  });

  it("earns one skip day per 4 swim days", () => {
    expect(
      computeStreak([daysAgo(2), daysAgo(1), daysAgo(0)]).skipsAvailable,
    ).toBe(0);
    expect(
      computeStreak([daysAgo(3), daysAgo(2), daysAgo(1), daysAgo(0)])
        .skipsAvailable,
    ).toBe(1);
    const eight = Array.from({ length: 8 }, (_, i) => daysAgo(i));
    expect(computeStreak(eight).skipsAvailable).toBe(2);
  });

  it("a gap without an earned skip breaks the streak", () => {
    // 3 swim days, miss one, swim today → only today counts.
    const st = computeStreak([daysAgo(4), daysAgo(3), daysAgo(2), daysAgo(0)]);
    expect(st.current).toBe(1);
    expect(st.longest).toBe(3);
  });

  it("a gap covered by an earned skip keeps the streak alive", () => {
    // 4 swim days, miss one, swim today → streak lives on, 5 swim days.
    // The buoy day itself doesn't count toward the length.
    const st = computeStreak([
      daysAgo(5),
      daysAgo(4),
      daysAgo(3),
      daysAgo(2),
      daysAgo(0),
    ]);
    expect(st.current).toBe(5);
    expect(st.swimDays).toBe(5);
    expect(st.skipsUsed).toBe(1);
    expect(st.skipsAvailable).toBe(0); // floor(5/4) = 1, spent
    expect(st.dayTypes.get(dayStartMs(daysAgo(1)))).toBe("skip");
    expect(st.dayTypes.get(dayStartMs(daysAgo(0)))).toBe("swim");
  });

  it("8 swim days cover a 2-day gap", () => {
    const dates = [
      ...Array.from({ length: 8 }, (_, i) => daysAgo(10 - i)), // 10..3 days ago
      daysAgo(0),
    ];
    const st = computeStreak(dates);
    expect(st.current).toBe(9); // 9 swims; the 2 buoy days don't count
    expect(st.skipsUsed).toBe(2);
    expect(st.skipsAvailable).toBe(0); // floor(9/4) = 2, spent
  });

  it("a pending gap up to today is covered by a buoy (and flags at-risk)", () => {
    // 4 swim days ending 2 days ago: yesterday consumed the buoy, today pending.
    const st = computeStreak([daysAgo(5), daysAgo(4), daysAgo(3), daysAgo(2)]);
    expect(st.current).toBe(4);
    expect(st.skipsUsed).toBe(1);
    expect(st.skipsAvailable).toBe(0);
    expect(st.atRisk).toBe(true);
    expect(st.onBuoy).toBe(false);
  });

  it("a pending gap larger than the buoy balance kills the streak", () => {
    const st = computeStreak([daysAgo(6), daysAgo(5), daysAgo(4), daysAgo(3)]);
    expect(st.current).toBe(0);
    expect(st.currentStart).toBeNull();
    expect(st.longest).toBe(4);
  });

  it("last swim yesterday needs no buoy but is at risk without one", () => {
    const st = computeStreak([daysAgo(2), daysAgo(1)]);
    expect(st.current).toBe(2);
    expect(st.skipsUsed).toBe(0);
    expect(st.atRisk).toBe(true);
  });

  it("last swim yesterday with a buoy in the bank is protected, not at risk", () => {
    const st = computeStreak([daysAgo(4), daysAgo(3), daysAgo(2), daysAgo(1)]);
    expect(st.current).toBe(4);
    expect(st.skipsAvailable).toBe(1);
    expect(st.atRisk).toBe(false);
    expect(st.onBuoy).toBe(true);
  });

  it("tracks the longest streak across broken runs", () => {
    const st = computeStreak([
      daysAgo(20),
      daysAgo(19),
      daysAgo(18),
      daysAgo(17),
      daysAgo(16),
      daysAgo(1),
      daysAgo(0),
    ]);
    expect(st.current).toBe(2);
    expect(st.longest).toBe(5);
  });

  it("longestStreakInYear only counts swims in that year", () => {
    // Noon avoids midnight edge cases, as elsewhere.
    const on = (y: number, m: number, d: number) =>
      new Date(y, m, d, 12).getTime();
    const dates = [
      // 3-day run in June 2025
      on(2025, 5, 10),
      on(2025, 5, 11),
      on(2025, 5, 12),
      // 4-day run spanning New Year: Dec 30–31 2024, Jan 1–2 2025
      on(2024, 11, 30),
      on(2024, 11, 31),
      on(2025, 0, 1),
      on(2025, 0, 2),
    ];
    expect(longestStreakInYear(dates, 2025)).toBe(3);
    expect(longestStreakInYear(dates, 2024)).toBe(2);
    expect(longestStreakInYear(dates, 2023)).toBe(0);
  });

  it("buoys do not carry over into a new streak", () => {
    // 8-day run long ago (earned 2), then a big gap, then 2 fresh days with a
    // 1-day hole — the hole is NOT covered by the old run's buoys.
    const st = computeStreak([
      ...Array.from({ length: 8 }, (_, i) => daysAgo(30 - i)),
      daysAgo(2),
      daysAgo(0),
    ]);
    expect(st.current).toBe(1);
  });
});

describe("streakTier / streakLevel", () => {
  it("escalates tiers at 3/7/30", () => {
    expect(streakTier(0)).toBe("plain");
    expect(streakTier(2)).toBe("plain");
    expect(streakTier(3)).toBe("bubbly");
    expect(streakTier(6)).toBe("bubbly");
    expect(streakTier(7)).toBe("fire");
    expect(streakTier(29)).toBe("fire");
    expect(streakTier(30)).toBe("disco");
  });

  it("fire ramps at 10 and 20", () => {
    expect(streakLevel(7)).toBe(1);
    expect(streakLevel(9)).toBe(1);
    expect(streakLevel(10)).toBe(2);
    expect(streakLevel(19)).toBe(2);
    expect(streakLevel(20)).toBe(3);
    expect(streakLevel(29)).toBe(3);
  });

  it("disco ramps at 40 and 50, resetting to level 1 at the tier jump", () => {
    expect(streakLevel(30)).toBe(1);
    expect(streakLevel(39)).toBe(1);
    expect(streakLevel(40)).toBe(2);
    expect(streakLevel(49)).toBe(2);
    expect(streakLevel(50)).toBe(3);
    expect(streakLevel(365)).toBe(3);
  });

  it("plain and bubbly have a single level", () => {
    expect(streakLevel(0)).toBe(1);
    expect(streakLevel(5)).toBe(1);
  });
});
