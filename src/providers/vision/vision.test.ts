import { describe, expect, it } from "vitest";
import { looksLikeNoImage, providerCanCarryImages } from "./index";

/**
 * The guard has to separate two things that both look like prose: a model saying
 * it never got the picture, and a model describing one. Getting it wrong in one
 * direction hands the assistant a confident account of a drawing nobody showed
 * it; getting it wrong in the other throws away a real description. The strings
 * below in the first group are verbatim replies observed from a local model that
 * advertised vision support and did not process images.
 */

describe("looksLikeNoImage", () => {
  const NO_IMAGE = [
    // Observed, 30 Aug 2026, gemma4 over Ollama.
    "I need the image of the research board to describe the freehand drawing. Please provide the image you are referring to!",
    "Please provide the image of the research board. I need the visual context to describe the freehand drawing, the IDs, and the connections as requested.",
    "I cannot tell you the color because no image was provided. Please upload the picture you are referring to!",
    // Plausible variants of the same refusal.
    "No image was attached to your message.",
    "I don't see any image here.",
  ];

  const REAL_DESCRIPTIONS = [
    "A red arrow runs from block n1 to block n2, suggesting a comparison.",
    "A violet ellipse encircles block n1 alone.",
    "The drawing is a rough circle around two cards, with a question mark beside it.",
    // The important near-miss: a genuine description of an *empty* picture. The
    // model saw the image; there was simply nothing drawn on it.
    "The image is blank — I can see the dashed outlines but no freehand marks at all.",
    "There is no arrow in the picture, only a circle.",
  ];

  it("catches a model asking to be sent the picture", () => {
    for (const text of NO_IMAGE) {
      expect(looksLikeNoImage(text), text).toBe(true);
    }
  });

  it("lets a real description through, including of an empty picture", () => {
    for (const text of REAL_DESCRIPTIONS) {
      expect(looksLikeNoImage(text), text).toBe(false);
    }
  });

  it("does not fire on an empty string", () => {
    // Handled separately as "no description at all", with its own message.
    expect(looksLikeNoImage("")).toBe(false);
  });
});

describe("providerCanCarryImages", () => {
  it("accepts every provider with an image request shape here", () => {
    for (const id of ["anthropic", "openai", "google", "groq", "cerebras", "custom"]) {
      expect(providerCanCarryImages(id), id).toBe(true);
    }
  });

  it("rejects anything without one", () => {
    // Speech and search providers share the id namespace in the keychain, so a
    // stale setting can name one of them here.
    expect(providerCanCarryImages("deepgram")).toBe(false);
    expect(providerCanCarryImages("")).toBe(false);
  });
});
