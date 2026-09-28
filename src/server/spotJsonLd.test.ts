import { describe, expect, it } from "vitest";
import { buildSpotJsonLd, serializeJsonLd } from "./spotJsonLd";

const url = "https://badligan.club/spot/abc";
const hav =
  "https://badplatsen.havochvatten.se/badplatsen/karta/#/bath/SE0230581000001746";

describe("buildSpotJsonLd", () => {
  it("describes the spot as a Beach with geo and canonical url", () => {
    expect(
      buildSpotJsonLd({ name: "Långholmen", lat: 59.32, lng: 18.03 }, url),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "Beach",
      name: "Långholmen",
      url,
      geo: { "@type": "GeoCoordinates", latitude: 59.32, longitude: 18.03 },
    });
  });

  it("links the official source page as sameAs", () => {
    const ld = buildSpotJsonLd(
      {
        name: "A",
        lat: 1,
        lng: 2,
        info: "Sandstrand.",
        infoSource: "havochvatten.se",
        infoUrl: hav,
      },
      url,
    );
    expect(ld.sameAs).toBe(hav);
    expect(ld.description).toBe("Sandstrand.");
  });

  it("never asserts sameAs for user info or a non-https link", () => {
    const base = { name: "A", lat: 1, lng: 2 };
    expect(
      buildSpotJsonLd({ ...base, infoSource: "user", infoUrl: hav }, url),
    ).not.toHaveProperty("sameAs");
    expect(
      buildSpotJsonLd({ ...base, infoUrl: "javascript:alert(1)" }, url),
    ).not.toHaveProperty("sameAs");
  });

  it("clips a long description and omits geo it can't trust", () => {
    const ld = buildSpotJsonLd(
      { name: "A", lat: Number.NaN, lng: 2, info: "ord ".repeat(400) },
      url,
    );
    expect((ld.description as string).length).toBeLessThanOrEqual(501);
    expect(ld).not.toHaveProperty("geo");
  });
});

describe("serializeJsonLd", () => {
  it("escapes < so a description can't close the script tag", () => {
    const out = serializeJsonLd({ d: "</script><b>" });
    expect(out).not.toContain("<");
    expect(JSON.parse(out)).toEqual({ d: "</script><b>" });
  });
});
