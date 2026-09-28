import { describe, expect, it } from "vitest";
import {
  buildSitemapEntries,
  entriesFromPlacesSummaryDoc,
  sitemapDate,
  STATIC_ROUTES,
} from "./sitemap";
import type { PlaceSummaryEntry } from "@/lib/types";

const place = (n: string): PlaceSummaryEntry => ({ n, la: 59, lo: 18 });

describe("entriesFromPlacesSummaryDoc", () => {
  it("reads the packed JSON field", () => {
    const entries = { a: place("Alpha") };
    expect(
      entriesFromPlacesSummaryDoc({
        builtAt: 1,
        packed: JSON.stringify(entries),
      }),
    ).toEqual(entries);
  });

  it("falls back to a legacy entries map", () => {
    const entries = { a: place("Alpha") };
    expect(entriesFromPlacesSummaryDoc({ builtAt: 1, entries })).toEqual(
      entries,
    );
  });

  it("returns an empty map for a missing, empty or broken doc", () => {
    expect(entriesFromPlacesSummaryDoc(null)).toEqual({});
    expect(entriesFromPlacesSummaryDoc({ builtAt: 0 })).toEqual({});
    expect(entriesFromPlacesSummaryDoc({ builtAt: 0, packed: "{" })).toEqual(
      {},
    );
    expect(
      entriesFromPlacesSummaryDoc({ builtAt: 0, packed: "[1,2]" }),
    ).toEqual({});
  });
});

describe("sitemapDate", () => {
  it("uses the timestamp when it is usable", () => {
    expect(sitemapDate(1_600_000_000_000)?.getTime()).toBe(1_600_000_000_000);
  });
  it("returns undefined for anything that isn't a positive finite number", () => {
    expect(sitemapDate(undefined)).toBeUndefined();
    expect(sitemapDate("2026-01-01")).toBeUndefined();
    expect(sitemapDate(Number.NaN)).toBeUndefined();
    expect(sitemapDate(0)).toBeUndefined();
    expect(sitemapDate(8.64e15 + 1)).toBeUndefined();
  });
});

describe("buildSitemapEntries", () => {
  const origin = "https://badligan.club";
  const lastSwim = 1_690_000_000_000;

  it("lists the static routes first, then the places", () => {
    const entries = buildSitemapEntries({
      origin,
      placeEntries: { b: place("Beta"), a: place("Alpha") },
    });
    expect(entries.map((e) => e.url)).toEqual([
      ...STATIC_ROUTES.map((path) => `${origin}${path}`),
      `${origin}/spot/a`,
      `${origin}/spot/b`,
    ]);
  });

  it("dates a spot by its last swim and nothing else", () => {
    const entries = buildSitemapEntries({
      origin,
      placeEntries: {
        a: { ...place("Alpha"), s: lastSwim },
        b: place("Beta"),
      },
    });
    const byUrl = Object.fromEntries(entries.map((e) => [e.url, e]));
    expect(byUrl[`${origin}/spot/a`].lastModified?.getTime()).toBe(lastSwim);
    expect(byUrl[`${origin}/spot/b`]).not.toHaveProperty("lastModified");
  });

  it("emits only url (+ honest lastmod) — no changefreq, priority or fake dates", () => {
    const entries = buildSitemapEntries({
      origin,
      placeEntries: { a: { ...place("Alpha"), s: lastSwim } },
    });
    for (const e of entries.slice(0, STATIC_ROUTES.length)) {
      expect(Object.keys(e)).toEqual(["url"]);
    }
    expect(Object.keys(entries.at(-1)!).toSorted()).toEqual([
      "lastModified",
      "url",
    ]);
  });

  it("skips nameless entries — they cannot render a spot page", () => {
    const entries = buildSitemapEntries({
      origin,
      placeEntries: {
        a: place("Alpha"),
        b: { la: 1, lo: 2 } as PlaceSummaryEntry,
        c: { n: "", la: 1, lo: 2 },
      },
    });
    expect(entries.filter((e) => e.url.includes("/spot/"))).toHaveLength(1);
  });

  it("percent-encodes ids and trims a trailing slash off the origin", () => {
    const entries = buildSitemapEntries({
      origin: "https://badligan.club/",
      placeEntries: { "a b": place("Alpha") },
    });
    expect(entries[0].url).toBe("https://badligan.club/");
    expect(entries.at(-1)!.url).toBe("https://badligan.club/spot/a%20b");
  });

  it("rejects a non-absolute origin", () => {
    expect(() =>
      buildSitemapEntries({ origin: "/badligan", placeEntries: {} }),
    ).toThrow(/absolute/);
  });
});
