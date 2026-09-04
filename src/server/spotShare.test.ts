import { describe, expect, it } from "vitest";
import { buildSpotShare, truncateShareText } from "./spotShare";

describe("truncateShareText", () => {
  it("collapses whitespace and leaves short text alone", () => {
    expect(truncateShareText("  a\n b  ", 20)).toBe("a b");
  });

  it("clips on a word boundary and adds an ellipsis", () => {
    const s = "Nedre Rudasjön ligger i Haninge kommun och är en fin badsjö";
    const out = truncateShareText(s, 30);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(31);
    expect(out).toBe("Nedre Rudasjön ligger i…");
  });

  it("hard-cuts when there is no late word boundary", () => {
    expect(truncateShareText("a".repeat(50), 10)).toBe("aaaaaaaaaa…");
  });

  it("tolerates null and undefined", () => {
    expect(truncateShareText(null, 10)).toBe("");
    expect(truncateShareText(undefined, 10)).toBe("");
  });
});

describe("buildSpotShare", () => {
  it("titles the card after the place", () => {
    expect(buildSpotShare({ name: "Nedre Rudan" }).title).toBe(
      "Nedre Rudan på Badligan",
    );
  });

  it("leads with the spot's own info, then the stats", () => {
    expect(
      buildSpotShare({
        name: "Nedre Rudan",
        info: "En fin badsjö.",
        temp: 18.63,
        swimCount: 42,
      }).description,
    ).toBe("En fin badsjö. · 18.6 °C i vattnet · 42 bad");
  });

  it("falls back to the stats plus a nudge when there is no info", () => {
    expect(
      buildSpotShare({ name: "Havsbadet", temp: 9, swimCount: 3 }).description,
    ).toBe("9.0 °C i vattnet · 3 bad · Kolla in Havsbadet på Badligan.");
  });

  it("omits a missing temperature and a zero swim count", () => {
    expect(
      buildSpotShare({ name: "Havsbadet", temp: null, swimCount: 0 })
        .description,
    ).toBe(
      "Kolla in Havsbadet på Badligan – logga dina bad, samla badplatser på kartan och tävla med vänner om poäng.",
    );
  });

  it("keeps the info-only description when nothing else is known", () => {
    expect(
      buildSpotShare({ name: "Havsbadet", info: "Sandstrand." }).description,
    ).toBe("Sandstrand.");
  });
});
