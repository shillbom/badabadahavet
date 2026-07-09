import { describe, it, expect } from "vitest";
import { computeMyStats } from "./stats";
import type { SessionDoc } from "./types";

const DAY = 86_400_000;
// Noon `n` days ago — noon avoids midnight/timezone edge cases in day math.
const daysAgo = (n: number) => {
  const d = new Date(Date.now() - n * DAY);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
};

let seq = 0;
function s(
  over: Partial<SessionDoc> & { placeId: string; date: number },
): SessionDoc {
  return {
    id: `s${seq++}`,
    uid: "u1",
    displayName: "U",
    placeName: over.placeId,
    lat: 0,
    lng: 0,
    isUniqueForUser: false,
    isWinter: false,
    points: 1,
    createdAt: over.date,
    ...over,
  };
}

describe("computeMyStats", () => {
  it("returns zeroed stats for no sessions", () => {
    const st = computeMyStats([]);
    expect(st.totalSwims).toBe(0);
    expect(st.totalPoints).toBe(0);
    expect(st.uniquePlaces).toBe(0);
    expect(st.swimsLastWeek).toBe(0);
    expect(st.favouriteSpot).toBeNull();
  });

  it("aggregates totals, recent windows, and the favourite spot", () => {
    const sessions = [
      s({ placeId: "p1", date: daysAgo(0), points: 1 }),
      s({ placeId: "p1", date: daysAgo(2), points: 1 }),
      s({ placeId: "p2", date: daysAgo(10), points: 3, isWinter: true }),
      s({ placeId: "p3", date: daysAgo(40), points: 1 }),
    ];
    const st = computeMyStats(sessions);

    expect(st.totalSwims).toBe(4);
    expect(st.uniquePlaces).toBe(3);
    expect(st.winterSwims).toBe(1);
    expect(st.totalPoints).toBe(6);
    // p1 has two swims → favourite.
    expect(st.favouriteSpot?.placeId).toBe("p1");
    expect(st.favouriteSpot?.count).toBe(2);
    // Trailing windows.
    expect(st.swimsLastWeek).toBe(2); // today + 2 days ago
    expect(st.swimsLastMonth).toBe(3); // + 10 days ago (40 days ago excluded)
    // Unique places this month: p1 (twice) + p2 = 2; p3 (40 days ago) excluded.
    expect(st.placesLastMonth).toBe(2);
  });

  it("counts a current day streak (today only = 1)", () => {
    const st = computeMyStats([s({ placeId: "p1", date: daysAgo(0) })]);
    expect(st.currentDayStreak).toBe(1);
  });

  it("counts consecutive days (today + yesterday = 2)", () => {
    const st = computeMyStats([
      s({ placeId: "p1", date: daysAgo(0) }),
      s({ placeId: "p1", date: daysAgo(1) }),
    ]);
    expect(st.currentDayStreak).toBe(2);
  });
});
