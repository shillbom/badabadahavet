import { afterEach, describe, expect, it } from "vitest";
import { getRecentSwimMessage, useLocale } from "./i18n";

describe("getRecentSwimMessage", () => {
  afterEach(() => useLocale.setState({ locale: "sv" }));

  it("offers stable Swedish variants for today's and yesterday's swims", () => {
    useLocale.setState({ locale: "sv" });

    const today = Array.from({ length: 5 }, (_, seed) =>
      getRecentSwimMessage("today", seed),
    );
    const yesterday = Array.from({ length: 5 }, (_, seed) =>
      getRecentSwimMessage("yesterday", seed),
    );

    expect(new Set(today)).toHaveLength(5);
    expect(new Set(yesterday)).toHaveLength(5);
    expect(getRecentSwimMessage("today", 2)).toBe(today[2]);
  });

  it("uses English variants when English is active", () => {
    useLocale.setState({ locale: "en" });

    expect(getRecentSwimMessage("today", 0)).toBe("You swam today — nice!");
    expect(getRecentSwimMessage("yesterday", 0)).toBe("You swam yesterday.");
  });
});
