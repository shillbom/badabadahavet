import { describe, it, expect } from "vitest";
import {
  ACHIEVEMENTS_BY_ID,
  achievementProgress,
  computeAchievementStats,
  evaluateAchievements,
} from "./achievements";
import type { SessionDoc } from "./types";

let seq = 0;
function s(over: Partial<SessionDoc> & { placeId: string }): SessionDoc {
  return {
    id: `s${seq++}`,
    uid: "u1",
    displayName: "U",
    placeName: over.placeId,
    lat: 0,
    lng: 0,
    date: Date.UTC(2026, 5, 1, 12) + seq * 1000,
    isUniqueForUser: false,
    isWinter: false,
    points: 1,
    createdAt: 0,
    ...over,
  };
}

describe("evaluateAchievements", () => {
  it("unlocks the first-swim badge with one session", () => {
    const mine = [s({ placeId: "p1" })];
    const unlocked = evaluateAchievements({
      uid: "u1",
      mySessions: mine,
      allSessions: mine,
    });
    expect(unlocked.has("ICE_BREAKER")).toBe(true);
    expect(unlocked.has("COLLECTOR")).toBe(false);
  });

  it("unlocks the spot collector at five unique places", () => {
    const mine = ["p1", "p2", "p3", "p4", "p5"].map((placeId) =>
      s({ placeId }),
    );
    const unlocked = evaluateAchievements({
      uid: "u1",
      mySessions: mine,
      allSessions: mine,
    });
    expect(unlocked.has("COLLECTOR")).toBe(true);
    expect(unlocked.has("EXPLORER")).toBe(false); // needs 15
  });

  it("unlocks the winter badge on a winter dip", () => {
    const mine = [s({ placeId: "p1", isWinter: true })];
    const unlocked = evaluateAchievements({
      uid: "u1",
      mySessions: mine,
      allSessions: mine,
    });
    expect(unlocked.has("POLAR_BEAR")).toBe(true);
  });
});

describe("computeAchievementStats", () => {
  it("only counts other swimmers at shared spots", () => {
    const mine = [s({ placeId: "p1", uid: "u1" })];
    const all = [
      ...mine,
      s({ placeId: "p1", uid: "u2" }),
      s({ placeId: "p1", uid: "u3" }),
      s({ placeId: "elsewhere", uid: "u4" }),
    ];
    const stats = computeAchievementStats({
      uid: "u1",
      mySessions: mine,
      allSessions: all,
    });
    expect(stats.maxSharedSwimmers).toBe(2);
  });

  it("reports zeroed stats for no sessions", () => {
    const stats = computeAchievementStats({
      uid: "ghost",
      mySessions: [],
      allSessions: [s({ placeId: "p1", uid: "u1" })],
    });
    expect(stats.swims).toBe(0);
    expect(stats.rangeKm).toBe(0);
    expect(stats.bestDayStreak).toBe(0);
    expect(stats.bestWeekStreak).toBe(0);
  });
});

describe("achievementProgress", () => {
  it("clamps to 0..1 against the goal", () => {
    const mine = ["p1", "p2"].map((placeId) => s({ placeId }));
    const stats = computeAchievementStats({
      uid: "u1",
      mySessions: mine,
      allSessions: mine,
    });
    // 2 of 5 unique places toward COLLECTOR.
    expect(
      achievementProgress(ACHIEVEMENTS_BY_ID.COLLECTOR, stats),
    ).toBeCloseTo(0.4);
    // 2 swims ≥ 1 goal → clamped to 1.
    expect(achievementProgress(ACHIEVEMENTS_BY_ID.ICE_BREAKER, stats)).toBe(1);
  });
});
