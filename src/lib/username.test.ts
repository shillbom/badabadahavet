import { describe, it, expect } from "vitest";
import { usernameHasProfanity, assertUsernameClean } from "./username";
import { ModerationError } from "./moderation";

describe("username profanity check", () => {
  it("passes ordinary names, incl. Swedish words that embed short roots", async () => {
    // The zero-false-positive guarantee: none of these may trip, even though
    // they contain "anal"/"ass"/"kuk"/"slut"/"penn" as substrings.
    for (const name of [
      "Simon",
      "Anna Svensson",
      "Björn Öberg",
      "Kallbadaren",
      "analytiker",
      "Scunthorpe",
      "kass",
      "Hasse",
      "Slutstation", // "slut" = "the end" in Swedish
      "Kukkola",
      "penningar", // "money" — glin fuzzy-matches this to "penis"; we don't
      "Dickson",
    ]) {
      expect(await usernameHasProfanity(name), name).toBe(false);
    }
  });

  it("flags standalone English and Swedish profanity", async () => {
    for (const name of ["fucker", "shithead", "kuk", "fitta"]) {
      expect(await usernameHasProfanity(name), name).toBe(true);
    }
  });

  it("flags profanity concatenated into a name", async () => {
    for (const name of [
      "penisDikatorn", // camelCase → segment "penis"
      "penisdiktatorn", // lowercase run-together → substring "penis"
      "BigDick99", // camelCase + digits → segment "Dick"
      "P3nisMan", // leetspeak + camelCase
    ]) {
      expect(await usernameHasProfanity(name), name).toBe(true);
    }
  });

  it("sees through leetspeak evasion", async () => {
    expect(await usernameHasProfanity("f4ck")).toBe(true);
  });

  it("treats blank input as clean", async () => {
    expect(await usernameHasProfanity("   ")).toBe(false);
    expect(await usernameHasProfanity("")).toBe(false);
  });

  it("assertUsernameClean throws only for profane names", async () => {
    await expect(assertUsernameClean("Simon")).resolves.toBeUndefined();
    await expect(assertUsernameClean("fucker")).rejects.toBeInstanceOf(
      ModerationError,
    );
  });
});
