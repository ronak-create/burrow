import { describe, expect, it } from "vitest";
import { levenshtein, matchAnyWake, matchWake, soundex, tokenMatches, tokenize } from "./wake";

/**
 * Two failure modes, both silent. A phrase that never matches makes the headline
 * feature appear dead with nothing on screen to explain it; a phrase that matches
 * too readily activates the assistant during ordinary conversation, which is what
 * makes always-listening features unbearable. Both directions are pinned here.
 */

const PHRASE = "hey burrow";

describe("matchWake", () => {
  it("matches the phrase as spoken", () => {
    expect(matchWake("Hey Burrow", PHRASE).hit).toBe(true);
  });

  it("ignores the punctuation and capitalisation Whisper invents", () => {
    // None of this is information about what was said.
    for (const heard of ["hey, burrow.", "Hey — Burrow!", "  HEY   BURROW  "]) {
      expect(matchWake(heard, PHRASE).hit).toBe(true);
    }
  });

  it("matches the distinctive word without its carrier", () => {
    // "hey" is the most-dropped word in any transcript.
    expect(matchWake("Burrow, add a note", PHRASE).hit).toBe(true);
  });

  it("tolerates a carrier the model heard as something else", () => {
    // "Hey" arriving as "A" is a routine transcription of a clipped first word.
    expect(matchWake("A burrow, what is on the board?", PHRASE).hit).toBe(true);
  });

  it("matches homophones of the name, which is the whole point", () => {
    for (const heard of ["hey borrow", "hey burro", "hey bureau", "hey barrow"]) {
      expect(matchWake(heard, PHRASE).hit).toBe(true);
    }
  });

  it("carries the rest of the utterance through as the command", () => {
    // Waking and then discarding the instruction would make the user say
    // everything twice — worse than the button this replaces.
    expect(matchWake("Hey Burrow, add a note about Redis", PHRASE).rest).toBe(
      "add a note about redis",
    );
  });

  it("reports an empty rest when only the wake word was said", () => {
    expect(matchWake("Hey Burrow", PHRASE)).toEqual({ hit: true, rest: "" });
  });

  it("tolerates filler before the phrase", () => {
    expect(matchWake("um, so, hey Burrow, open the board", PHRASE).hit).toBe(true);
  });

  it("does not fire on the word buried mid-sentence", () => {
    // The one that matters. Without a lead window, ordinary conversation about a
    // burrow would activate the assistant.
    expect(matchWake("I was reading that the rabbit burrow collapsed", PHRASE).hit).toBe(false);
  });

  it("does not fire on unrelated speech", () => {
    for (const heard of ["what time is it", "the meeting is at four", ""]) {
      expect(matchWake(heard, PHRASE).hit).toBe(false);
    }
  });

  it("requires every distinctive word of a multi-word phrase", () => {
    // "red raptor" has no carrier to drop, so half of it must not be enough.
    expect(matchWake("raptor", "red raptor").hit).toBe(false);
    expect(matchWake("red raptor go", "red raptor")).toEqual({ hit: true, rest: "go" });
  });

  it("matches a phrase of nothing but carriers in full", () => {
    // "hey ok" has no distinctive word to fall back to. Stripping its carriers
    // would leave nothing, and an empty phrase matches everything — the
    // assistant would wake on any sound at all. So it must be matched whole.
    expect(matchWake("hey ok", "hey ok").hit).toBe(true);
    expect(matchWake("ok", "hey ok").hit).toBe(false);
  });

  it("treats an empty configured phrase as never matching", () => {
    expect(matchWake("anything at all", "").hit).toBe(false);
    expect(matchWake("anything at all", "   ").hit).toBe(false);
  });
});

/**
 * Transcripts observed, not imagined.
 *
 * These are the exact strings whisper.cpp (ggml-base.en) returned for speech
 * synthesized through the two Windows SAPI voices, captured 30 Aug 2026. The
 * module deliberately ships no invented table of mishearings; this is the
 * measured version, and it is the evidence that phonetic matching was necessary
 * rather than defensive — the model produced four different spellings of the
 * name across ten utterances and got it exactly right twice.
 */
describe("real whisper.cpp output", () => {
  const WOKE = [
    "Hey, Baro.",
    "Hey, Barrow, add a note about Reedy's persistence.",
    "Burro, what is on the board?",
    "Hey, Burro.",
    "Hey, Burrow. Add a note about Reedy's persistence.",
    "Burrow. What is on the board?",
  ];

  const DID_NOT = [
    // The name said in the middle of an ordinary sentence.
    "I was reading that the rabbit burrow collapsed last winter.",
    "Summarize the paper I just opened.",
    "Summer rise the paper I just opened.",
  ];

  it("wakes on every spelling the model actually produced", () => {
    for (const heard of WOKE) {
      expect(matchWake(heard, PHRASE).hit, heard).toBe(true);
    }
  });

  it("stays asleep through the rest", () => {
    for (const heard of DID_NOT) {
      expect(matchWake(heard, PHRASE).hit, heard).toBe(false);
    }
  });

  it("recovers the command from the same breath", () => {
    expect(matchWake("Hey, Barrow, add a note about Reedy's persistence.", PHRASE).rest).toBe(
      "add a note about reedy s persistence",
    );
    expect(matchWake("Burrow. What is on the board?", PHRASE).rest).toBe("what is on the board");
  });
});

/**
 * The same model, but a real microphone and a real voice.
 *
 * Captured 2 Sep 2026 through MicCheck: getUserMedia and the AudioWorklet inside
 * WebView2, the production detector, whisper.cpp on loopback. Two things came out
 * of it that files could not have produced.
 */
describe("live microphone output", () => {
  it("wakes on a fifth spelling of the name", () => {
    // "Barou" — not one of the four the synthesizer produced, and not in any
    // list this module ships. Soundex B600, same as the other four.
    expect(matchWake("Hello, hello, Barou. Hello, Barou.", PHRASE).hit).toBe(true);
  });

  it("stays asleep through whisper's silence hallucination", () => {
    // A segment the detector opened on room noise transcribes as "Thank you." —
    // whisper's well-known filler for near-silence. It arrived twice in one
    // three-segment test, so it is common, not a fluke.
    expect(matchWake("Thank you.", PHRASE).hit).toBe(false);
    expect(matchWake("Thanks for watching!", PHRASE).hit).toBe(false);
  });
});

describe("matchAnyWake", () => {
  it("accepts any of the configured spellings", () => {
    const phrases = "hey burrow, computer";
    expect(matchAnyWake("computer, what is this", phrases)).toEqual({
      hit: true,
      rest: "what is this",
    });
    expect(matchAnyWake("hey burrow", phrases).hit).toBe(true);
    expect(matchAnyWake("what is this", phrases).hit).toBe(false);
  });

  it("skips blank entries from a trailing comma", () => {
    expect(matchAnyWake("nothing relevant", "hey burrow, ,").hit).toBe(false);
  });
});

describe("soundex", () => {
  it("collapses the spellings of the name that sound alike", () => {
    const want = soundex("burrow");
    for (const variant of ["borrow", "burro", "bureau", "barrow"]) {
      expect(soundex(variant)).toBe(want);
    }
  });

  it("keeps genuinely different words apart", () => {
    expect(soundex("burrow")).not.toBe(soundex("window"));
    expect(soundex("red")).not.toBe(soundex("blue"));
  });

  it("survives an empty or non-alphabetic input", () => {
    expect(soundex("")).toBe("");
    expect(soundex("123")).toBe("");
  });
});

describe("tokenMatches", () => {
  it("will not match a short token on edit distance alone", () => {
    // At a one-edit budget, "a" would match most short words in the language,
    // and the carrier slot would swallow anything.
    expect(tokenMatches("at", "a")).toBe(false);
    expect(tokenMatches("a", "a")).toBe(true);
  });

  it("allows more slack in a longer word", () => {
    expect(tokenMatches("assistent", "assistant")).toBe(true);
  });
});

describe("levenshtein", () => {
  it("counts single edits of each kind", () => {
    expect(levenshtein("cat", "cat")).toBe(0);
    expect(levenshtein("cat", "cot")).toBe(1);
    expect(levenshtein("cat", "cats")).toBe(1);
    expect(levenshtein("cat", "at")).toBe(1);
  });

  it("handles an empty side", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });
});

describe("tokenize", () => {
  it("splits on anything that is not a letter or digit", () => {
    expect(tokenize("Hey, Burrow — add 3 notes!")).toEqual(["hey", "burrow", "add", "3", "notes"]);
  });

  it("returns nothing for empty or punctuation-only input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("... --- ...")).toEqual([]);
  });
});
