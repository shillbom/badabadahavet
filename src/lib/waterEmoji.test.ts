import { describe, expect, it } from "vitest";
import { WATER_EMOJIS, waterEmojiFor } from "./waterEmoji";

describe("waterEmojiFor", () => {
  it("is stable for the same seed", () => {
    expect(waterEmojiFor("abc123")).toBe(waterEmojiFor("abc123"));
  });

  it("always returns one of the known water emojis", () => {
    for (const seed of ["a", "session-1", "xY9", "🌊", "", "zzzzzzzz"]) {
      expect(WATER_EMOJIS).toContain(waterEmojiFor(seed));
    }
  });

  it("falls back to 🌊 for an empty seed", () => {
    expect(waterEmojiFor("")).toBe("🌊");
  });

  it("spreads across the set rather than collapsing to one value", () => {
    const seen = new Set(
      Array.from({ length: 200 }, (_, i) => waterEmojiFor(`swim-${i}`)),
    );
    expect(seen.size).toBeGreaterThan(1);
  });
});
