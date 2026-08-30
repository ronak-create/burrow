import { describe, expect, it } from "vitest";
import {
  initialSession,
  micLive,
  sessionStep,
  type SessionConfig,
  type SessionEvent,
  type SessionState,
} from "./session";

/**
 * Every rule in here is about timing or about what the microphone is doing, and
 * both are invisible from the outside. A wrong transition does not throw — it
 * produces an assistant that stops responding, or one that responds to itself.
 */

const CFG: SessionConfig = { wakePhrases: "hey burrow", idleSleepMs: 45_000 };

/** Fold a script of events, returning the final state and everything emitted. */
function play(events: SessionEvent[], from: SessionState = initialSession()) {
  let state = from;
  const commands: string[] = [];
  const flags: string[] = [];
  for (const event of events) {
    const r = sessionStep(state, event, CFG);
    state = r.state;
    if (r.command) commands.push(r.command);
    if (r.woke) flags.push("woke");
    if (r.slept) flags.push("slept");
  }
  return { state, commands, flags };
}

const awake = (): SessionState => play([{ type: "enable" }]).state;
const active = (): SessionState =>
  play([{ type: "enable" }, { type: "heard", text: "hey burrow" }]).state;

describe("enable and disable", () => {
  it("starts off, with the microphone released", () => {
    const state = initialSession();
    expect(state.mode).toBe("off");
    expect(micLive(state)).toBe(false);
  });

  it("enables into wake-word-only, never straight into active", () => {
    // Turning the microphone on is not the same as addressing the assistant.
    // Starting active would treat the first thing said afterwards as a command.
    const { state } = play([{ type: "enable" }]);
    expect(state.mode).toBe("wake");
    expect(micLive(state)).toBe(true);
  });

  it("hard-off releases the microphone from any mode", () => {
    for (const from of [awake(), active()]) {
      const { state } = play([{ type: "disable" }], from);
      expect(state.mode).toBe("off");
      expect(micLive(state)).toBe(false);
    }
  });

  it("clears busy on the way off, so re-enabling is not stuck", () => {
    const { state } = play(
      [{ type: "busy", value: true }, { type: "disable" }, { type: "enable" }],
      active(),
    );
    expect(state).toEqual({ mode: "wake", idleMs: 0, busy: false });
  });

  it("ignores enable when already listening", () => {
    const { state } = play([{ type: "enable" }], active());
    expect(state.mode).toBe("active");
  });
});

describe("waking", () => {
  it("ignores ordinary speech while in wake-word-only mode", () => {
    const { state, commands } = play(
      [{ type: "heard", text: "so what did you think of the paper" }],
      awake(),
    );
    expect(state.mode).toBe("wake");
    expect(commands).toEqual([]);
  });

  it("wakes on the phrase and reports it", () => {
    const { state, flags } = play([{ type: "heard", text: "Hey Burrow" }], awake());
    expect(state.mode).toBe("active");
    expect(flags).toEqual(["woke"]);
  });

  it("carries the rest of the same breath through as a command", () => {
    const { commands } = play(
      [{ type: "heard", text: "Hey Burrow, add a note about Redis" }],
      awake(),
    );
    expect(commands).toEqual(["add a note about redis"]);
  });

  it("wakes without a command when only the phrase was said", () => {
    const { commands, flags } = play([{ type: "heard", text: "hey burrow" }], awake());
    expect(flags).toEqual(["woke"]);
    expect(commands).toEqual([]);
  });

  it("hears nothing at all while off", () => {
    const { state, commands } = play([{ type: "heard", text: "hey burrow" }]);
    expect(state.mode).toBe("off");
    expect(commands).toEqual([]);
  });
});

describe("active listening", () => {
  it("treats plain speech as a command, no phrase needed", () => {
    const { commands } = play([{ type: "heard", text: "what is on the board" }], active());
    expect(commands).toEqual(["what is on the board"]);
  });

  it("strips the wake phrase when it is said out of habit", () => {
    // People keep saying it. It is not part of the request.
    const { commands } = play([{ type: "heard", text: "hey burrow what is on the board" }], active());
    expect(commands).toEqual(["what is on the board"]);
  });

  it("emits nothing for an utterance that was only the wake phrase", () => {
    const { commands, state } = play([{ type: "heard", text: "hey burrow" }], active());
    expect(commands).toEqual([]);
    expect(state.idleMs).toBe(0);
  });

  it("emits nothing for an empty transcript", () => {
    expect(play([{ type: "heard", text: "   " }], active()).commands).toEqual([]);
  });
});

describe("barge-in", () => {
  it("discards everything captured while the assistant is busy", () => {
    // Echo cancellation is not perfect. A spoken reply containing the app's own
    // name would otherwise wake it and be handed back to it as a command.
    const { commands } = play(
      [
        { type: "busy", value: true },
        { type: "heard", text: "hey burrow add a note" },
        { type: "busy", value: false },
      ],
      active(),
    );
    expect(commands).toEqual([]);
  });

  it("does not let the assistant's own reply wake it from sleep", () => {
    const { state } = play(
      [{ type: "busy", value: true }, { type: "heard", text: "hey burrow" }],
      awake(),
    );
    expect(state.mode).toBe("wake");
  });
});

describe("idle auto-sleep", () => {
  it("drops to wake-word-only after the configured period", () => {
    const { state, flags } = play([{ type: "tick", dtMs: CFG.idleSleepMs }], active());
    expect(state.mode).toBe("wake");
    expect(flags).toEqual(["slept"]);
  });

  it("does not sleep early", () => {
    const { state } = play([{ type: "tick", dtMs: CFG.idleSleepMs - 1 }], active());
    expect(state.mode).toBe("active");
  });

  it("restarts the clock every time the user says something", () => {
    const nearly = CFG.idleSleepMs - 1000;
    const { state } = play(
      [
        { type: "tick", dtMs: nearly },
        { type: "heard", text: "still here" },
        { type: "tick", dtMs: nearly },
      ],
      active(),
    );
    expect(state.mode).toBe("active");
  });

  it("does not count time spent waiting for the assistant", () => {
    // Sleeping while it was still talking would drop the microphone at exactly
    // the moment the user is most likely to reply to what they just heard.
    const { state } = play(
      [
        { type: "busy", value: true },
        { type: "tick", dtMs: CFG.idleSleepMs * 2 },
        { type: "busy", value: false },
        { type: "tick", dtMs: CFG.idleSleepMs - 1 },
      ],
      active(),
    );
    expect(state.mode).toBe("active");
  });

  it("keeps the microphone open when it sleeps — it is not an off switch", () => {
    const { state } = play([{ type: "tick", dtMs: CFG.idleSleepMs }], active());
    expect(micLive(state)).toBe(true);
  });

  it("does not tick in wake mode or off", () => {
    for (const from of [awake(), initialSession()]) {
      const { state } = play([{ type: "tick", dtMs: CFG.idleSleepMs * 5 }], from);
      expect(state.idleMs).toBe(0);
    }
  });

  it("wakes again after sleeping", () => {
    const { state, flags } = play(
      [{ type: "tick", dtMs: CFG.idleSleepMs }, { type: "heard", text: "hey burrow" }],
      active(),
    );
    expect(state.mode).toBe("active");
    expect(flags).toEqual(["slept", "woke"]);
  });
});
