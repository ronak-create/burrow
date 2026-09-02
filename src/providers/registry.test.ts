import { describe, expect, it, vi } from "vitest";

// The registry reaches the keychain through Tauri at import time; none of that is
// what this file is about.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../workspace/api", () => ({
  configuredProviders: async () => [],
  getApiKey: async () => null,
}));

const { migrate, SETTINGS_VERSION } = await import("./registry");

describe("migrate", () => {
  it("discards an stt provider chosen before local Whisper existed", () => {
    // Verbatim from a real pre-milestone-4 profile: no sttBaseUrl, and a keyed
    // provider that silently outranked the keyless default for two milestones.
    const saved = {
      llmProvider: "openai",
      llmModel: "gpt-5",
      sttProvider: "groq",
      searchProvider: "brave",
    };

    const out = migrate(saved);
    expect(out.sttProvider).toBeUndefined();
    // Everything else it said is still its own business.
    expect(out.llmProvider).toBe("openai");
    expect(out.llmModel).toBe("gpt-5");
    expect(out.searchProvider).toBe("brave");
  });

  it("leaves a deliberate choice alone once the field exists", () => {
    const saved = { sttProvider: "groq", sttBaseUrl: "" };
    expect(migrate(saved).sttProvider).toBe("groq");
  });

  it("preserves a hand-tuned sensitivity across the threshold re-anchoring", () => {
    // Chosen by ear on 2 Sep 2026 against openRms 0.02, where sensitivity 1 meant
    // 0.050. The anchor is now 0.050 itself, so the same threshold is sensitivity
    // 5 — the value the slider must land on for the room to sound the same.
    expect(migrate({ sttBaseUrl: "x", micSensitivity: 1 }).micSensitivity).toBe(5);
  });

  it("does not re-shift a sensitivity it has already moved", () => {
    const once = migrate({ sttBaseUrl: "x", micSensitivity: 1 });
    expect(migrate(once).micSensitivity).toBe(5);
  });

  it("clamps rather than running off the end of the slider", () => {
    expect(migrate({ sttBaseUrl: "x", micSensitivity: 9 }).micSensitivity).toBe(10);
  });

  it("passes through settings that never mentioned speech at all", () => {
    // Stamped on the way out, so the next release knows this file has been seen.
    expect(migrate({ canvasPattern: "grid" })).toEqual({
      canvasPattern: "grid",
      settingsVersion: SETTINGS_VERSION,
    });
  });
});
