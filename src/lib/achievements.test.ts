import { describe, it, expect } from "vitest";
import { evaluateAchievements, achievementCountForUid } from "./achievements";
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

describe("achievementCountForUid", () => {
  it("counts only the given user's unlocks", () => {
    const all = [
      s({ placeId: "p1", uid: "u1" }),
      s({ placeId: "p2", uid: "u2" }),
    ];
    // u1 has one swim → at least ICE_BREAKER.
    expect(achievementCountForUid("u1", all)).toBeGreaterThanOrEqual(1);
    // Someone with no sessions has none.
    expect(achievementCountForUid("ghost", all)).toBe(0);
  });
});
