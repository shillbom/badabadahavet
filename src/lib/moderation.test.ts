import { describe, expect, it } from "vitest";
import {
  DEFAULT_THRESHOLD,
  SEVERE_TOXICITY_THRESHOLD,
  isTextBlocked,
  parseScores,
} from "./moderation";

describe("isTextBlocked", () => {
  it("allows clean text", () => {
    expect(isTextBlocked({})).toBe(false);
    expect(isTextBlocked({ TOXICITY: 0.1, PROFANITY: 0.02 })).toBe(false);
  });

  it("blocks when a general attribute crosses its threshold", () => {
    expect(isTextBlocked({ TOXICITY: DEFAULT_THRESHOLD })).toBe(true);
    expect(isTextBlocked({ PROFANITY: 0.95 })).toBe(true);
    expect(isTextBlocked({ INSULT: DEFAULT_THRESHOLD - 0.01 })).toBe(false);
  });

  it("uses the lower threshold for SEVERE_TOXICITY", () => {
    expect(isTextBlocked({ SEVERE_TOXICITY: SEVERE_TOXICITY_THRESHOLD })).toBe(
      true,
    );
    expect(
      isTextBlocked({ SEVERE_TOXICITY: SEVERE_TOXICITY_THRESHOLD - 0.01 }),
    ).toBe(false);
  });

  it("ignores non-numeric scores", () => {
    expect(
      isTextBlocked({ TOXICITY: "0.99" } as unknown as Record<string, number>),
    ).toBe(false);
  });
});

describe("parseScores", () => {
  it("extracts summary scores from a Perspective response", () => {
    expect(
      parseScores({
        attributeScores: {
          TOXICITY: { summaryScore: { value: 0.42 } },
          PROFANITY: { summaryScore: { value: 0.9 } },
        },
      }),
    ).toEqual({ TOXICITY: 0.42, PROFANITY: 0.9 });
  });

  it("tolerates malformed bodies", () => {
    expect(parseScores(null)).toEqual({});
    expect(parseScores("nope")).toEqual({});
    expect(parseScores({ attributeScores: { TOXICITY: {} } })).toEqual({});
    expect(
      parseScores({ attributeScores: { TOXICITY: { summaryScore: {} } } }),
    ).toEqual({});
  });
});
