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
  const fallback = new Date(1_700_000_000_000);
  it("uses the timestamp when it is usable", () => {
    expect(sitemapDate(1_600_000_000_000, fallback).getTime()).toBe(
      1_600_000_000_000,
    );
  });
  it("falls back for anything that isn't a finite number", () => {
    expect(sitemapDate(undefined, fallback)).toBe(fallback);
    expect(sitemapDate("2026-01-01", fallback)).toBe(fallback);
    expect(sitemapDate(Number.NaN, fallback)).toBe(fallback);
  });
});

describe("buildSitemapEntries", () => {
  const origin = "https://badligan.club";
  const now = 1_700_000_000_000;
  const builtAt = 1_690_000_000_000;

  it("lists the static routes first, then the places", () => {
    const entries = buildSitemapEntries({
      origin,
      placeEntries: { b: place("Beta"), a: place("Alpha") },
      builtAt,
      now,
    });
    expect(entries.map((e) => e.url)).toEqual([
      ...STATIC_ROUTES.map(({ path }) => `${origin}${path}`),
      `${origin}/spot/a`,
      `${origin}/spot/b`,
    ]);
  });

  it("stamps places with the summary build time and routes with now", () => {
    const entries = buildSitemapEntries({
      origin,
      placeEntries: { a: place("Alpha") },
      builtAt,
      now,
    });
    expect(entries[0].lastModified.getTime()).toBe(now);
    expect(entries.at(-1)!.lastModified.getTime()).toBe(builtAt);
  });

  it("falls back to now when builtAt is missing", () => {
    const entries = buildSitemapEntries({
      origin,
      placeEntries: { a: place("Alpha") },
      now,
    });
    expect(entries.at(-1)!.lastModified.getTime()).toBe(now);
  });

  it("skips nameless entries — they cannot render a spot page", () => {
    const entries = buildSitemapEntries({
      origin,
      placeEntries: {
        a: place("Alpha"),
        b: { la: 1, lo: 2 } as PlaceSummaryEntry,
        c: { n: "", la: 1, lo: 2 },
      },
      now,
    });
    expect(entries.filter((e) => e.url.includes("/spot/"))).toHaveLength(1);
  });

  it("percent-encodes ids and trims a trailing slash off the origin", () => {
    const entries = buildSitemapEntries({
      origin: "https://badligan.club/",
      placeEntries: { "a b": place("Alpha") },
      now,
    });
    expect(entries.at(-1)!.url).toBe("https://badligan.club/spot/a%20b");
  });

  it("rejects a non-absolute origin", () => {
    expect(() =>
      buildSitemapEntries({ origin: "/badligan", placeEntries: {}, now }),
    ).toThrow(/absolute/);
  });
});
