import { describe, expect, it } from "vitest";
import { routeChrome } from "./routeChrome";

describe("routeChrome", () => {
  it("gives the map the whole viewport", () => {
    expect(routeChrome("/", false)).toMatchObject({
      isMapPage: true,
      hideNav: false,
      contentWidth: "max-w-md lg:max-w-none",
    });
  });

  it("hides the nav on recap and the swim forms for everyone", () => {
    for (const path of ["/recap", "/log", "/swim/abc/edit"]) {
      expect(routeChrome(path, false)).toMatchObject({
        hideChrome: true,
        hideNav: true,
      });
    }
    expect(routeChrome("/recap", false).contentWidth).toBe("max-w-md");
  });

  it("hides only the nav for a guest on a spot page", () => {
    expect(routeChrome("/spot/abc", true)).toMatchObject({
      hideChrome: false,
      hideNav: true,
    });
    expect(routeChrome("/spot/abc", false).hideNav).toBe(false);
    expect(routeChrome("/leaderboard", true).hideNav).toBe(false);
  });
});
