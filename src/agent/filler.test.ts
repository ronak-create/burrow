import { describe, expect, it } from "vitest";
import { isFiller } from "./filler";

describe("isFiller", () => {
  it("drops what whisper actually returned for silence", () => {
    // Both observed on 2 Sep 2026, from a live microphone, unsaid.
    expect(isFiller("Thank you.")).toBe(true);
    expect(isFiller(" thank you ")).toBe(true);
  });

  it("drops the other documented inventions", () => {
    for (const t of ["Thanks for watching!", "Bye.", "you", "Bye bye."]) {
      expect(isFiller(t), t).toBe(true);
    }
  });

  it("drops bracketed sound tags", () => {
    for (const t of ["[BLANK_AUDIO]", "[Music]", "(upbeat music)", "(wind blowing)"]) {
      expect(isFiller(t), t).toBe(true);
    }
  });

  it("drops nothing at all", () => {
    expect(isFiller("")).toBe(true);
    expect(isFiller("   ")).toBe(true);
  });

  it("keeps anything a person plausibly said", () => {
    const real = [
      "Hey, Barou.",
      "Add a note about Redis",
      // The whole point of matching only the whole transcript: these contain a
      // filler phrase and are obviously speech.
      "thank you for adding that note",
      "say thank you on the card",
      // Left in on purpose — too close to real speech to guess at.
      "Okay.",
      "So.",
    ];
    for (const t of real) expect(isFiller(t), t).toBe(false);
  });
});
