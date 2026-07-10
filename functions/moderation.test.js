import { describe, expect, it } from "vitest";
import {
  PERSPECTIVE_ATTRIBUTES,
  checkTextAllowed,
  isTextBlocked,
  parseScores,
} from "./moderation.js";

const okResponse = (scores) => ({
  ok: true,
  json: async () => ({
    attributeScores: Object.fromEntries(
      Object.entries(scores).map(([k, v]) => [
        k,
        { summaryScore: { value: v } },
      ]),
    ),
  }),
});

describe("checkTextAllowed", () => {
  it("skips the API entirely without a key or text", async () => {
    let called = false;
    const fetchImpl = () => {
      called = true;
    };
    expect(await checkTextAllowed("bad text", "", { fetchImpl })).toBe(true);
    expect(await checkTextAllowed("   ", "key", { fetchImpl })).toBe(true);
    expect(called).toBe(false);
  });

  it("allows text under the thresholds", async () => {
    expect(
      await checkTextAllowed("ett fint bad", "key", {
        fetchImpl: async () => okResponse({ TOXICITY: 0.05 }),
      }),
    ).toBe(true);
  });

  it("blocks text over the thresholds", async () => {
    expect(
      await checkTextAllowed("something vile", "key", {
        fetchImpl: async () => okResponse({ SEVERE_TOXICITY: 0.9 }),
      }),
    ).toBe(false);
  });

  it("requests the Swedish-capable attribute set with doNotStore", async () => {
    let body;
    await checkTextAllowed("hej", "key", {
      fetchImpl: async (_url, init) => {
        body = JSON.parse(init.body);
        return okResponse({});
      },
    });
    expect(Object.keys(body.requestedAttributes)).toEqual(
      PERSPECTIVE_ATTRIBUTES,
    );
    expect(body.languages).toEqual(["sv", "en"]);
    expect(body.doNotStore).toBe(true);
  });

  it("fails open on HTTP errors and network failures", async () => {
    expect(
      await checkTextAllowed("text", "key", {
        fetchImpl: async () => ({ ok: false, status: 429 }),
      }),
    ).toBe(true);
    expect(
      await checkTextAllowed("text", "key", {
        fetchImpl: async () => {
          throw new Error("network down");
        },
      }),
    ).toBe(true);
  });
});

describe("isTextBlocked / parseScores", () => {
  it("round-trips a blocking response", () => {
    const scores = parseScores({
      attributeScores: { PROFANITY: { summaryScore: { value: 0.85 } } },
    });
    expect(isTextBlocked(scores)).toBe(true);
  });

  it("treats an empty response as allowed", () => {
    expect(isTextBlocked(parseScores({}))).toBe(false);
  });
});
