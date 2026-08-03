import { describe, expect, it } from "vitest";
import { buildSitemapXml, entriesFromPlacesSummaryDoc } from "./sitemap.js";

describe("entriesFromPlacesSummaryDoc", () => {
  it("reads packed entries when present", () => {
    expect(
      entriesFromPlacesSummaryDoc({
        packed: JSON.stringify({ a: { n: "Alpha", la: 1, lo: 2 } }),
      }),
    ).toEqual({ a: { n: "Alpha", la: 1, lo: 2 } });
  });

  it("falls back to legacy entries map", () => {
    expect(
      entriesFromPlacesSummaryDoc({ entries: { b: { n: "Beta" } } }),
    ).toEqual({ b: { n: "Beta" } });
  });
});

describe("buildSitemapXml", () => {
  it("includes landing page and place share URLs", () => {
    const xml = buildSitemapXml({
      origin: "https://badligan.club",
      builtAt: Date.UTC(2026, 6, 15),
      generatedAt: Date.UTC(2026, 7, 3),
      placeEntries: {
        "p/2": { n: "Bravo" },
        p1: { n: "Alpha" },
      },
    });

    expect(xml).toContain("<loc>https://badligan.club/</loc>");
    expect(xml).toContain("<lastmod>2026-08-03</lastmod>");
    expect(xml).toContain("<loc>https://badligan.club/s/p%2F2</loc>");
    expect(xml).toContain("<loc>https://badligan.club/s/p1</loc>");
    expect(xml).toContain("<lastmod>2026-07-15</lastmod>");
  });

  it("skips invalid place rows", () => {
    const xml = buildSitemapXml({
      origin: "https://badligan.club",
      placeEntries: {
        ok: { n: "Kallbad" },
        empty: { n: "" },
        missing: {},
      },
    });
    const locCount = (xml.match(/<loc>/g) ?? []).length;
    expect(locCount).toBe(2); // landing + one valid place
  });
});
