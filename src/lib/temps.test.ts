import { describe, it, expect } from "vitest";
import {
  asReading,
  freshestReading,
  summaryToMap,
  mergePlaceTemps,
} from "./temps";
import type { PlaceDoc, TempReading } from "./types";

const reading = (at: number, t = 17.5): TempReading => ({ t, at, p: "smhi" });

const place = (id: string): PlaceDoc => ({
  id,
  name: `Place ${id}`,
  lat: 59.3,
  lng: 18.1,
  createdBy: "u1",
  firstSwumAt: 1,
});

describe("asReading", () => {
  it("accepts a placeTemps doc and rejects one without a reading", () => {
    const doc = { placeId: "a", checkedAt: 5, ...reading(1000) };
    expect(asReading(doc)).toBe(doc);
    expect(asReading({ placeId: "a", checkedAt: 5 })).toBeNull();
    expect(asReading(null)).toBeNull();
  });
});

describe("freshestReading", () => {
  it("picks the newer reading, keeping the first on a tie", () => {
    const live = reading(2000);
    const summary = reading(1000);
    expect(freshestReading(live, summary)).toBe(live);
    expect(freshestReading(summary, live)).toBe(live);
    const tied = reading(2000);
    expect(freshestReading(live, tied)).toBe(live);
  });

  it("handles missing sides", () => {
    const r = reading(1000);
    expect(freshestReading(null, r)).toBe(r);
    expect(freshestReading(r, null)).toBe(r);
    expect(freshestReading(null, undefined)).toBeNull();
  });
});

describe("summaryToMap", () => {
  it("maps entries by placeId and drops malformed ones", () => {
    const m = summaryToMap({
      a: reading(1000),
      b: { t: NaN, at: 1, p: "smhi" },
    });
    expect(m.get("a")).toEqual(reading(1000));
    expect(m.has("b")).toBe(false);
  });

  it("tolerates a missing entries map", () => {
    expect(summaryToMap(undefined).size).toBe(0);
  });
});

describe("mergePlaceTemps", () => {
  it("spreads waterTemp fields onto matching places", () => {
    const places = [place("a"), place("b")];
    const merged = mergePlaceTemps(
      places,
      new Map([["a", reading(1000, 14.2)]]),
    );
    expect(merged[0]).toMatchObject({
      id: "a",
      waterTemp: 14.2,
      waterTempAt: 1000,
      waterTempProvider: "smhi",
    });
    // No entry → the exact same object passes through.
    expect(merged[1]).toBe(places[1]);
  });

  it("returns the input array itself when there are no temps", () => {
    const places = [place("a")];
    expect(mergePlaceTemps(places, new Map())).toBe(places);
  });
});
