import { describe, expect, it } from "vitest";
import {
  initialVadState,
  rms,
  VAD_DEFAULTS,
  vadStep,
  worthTranscribing,
  type VadState,
} from "./vad";

/**
 * The detector decides how often a local Whisper model is woken. Too eager and
 * the app transcribes the room forever, which is the battery cost this design
 * exists to avoid; too reluctant and the wake word is never heard at all. Neither
 * failure announces itself, so the machine is driven frame by frame here.
 */

const T = VAD_DEFAULTS;
const FRAME_MS = 10;

/** Run a script of [level, milliseconds] pairs and collect the transitions. */
function run(script: Array<[number, number]>, from: VadState = initialVadState()) {
  let state = from;
  const events: string[] = [];
  for (const [level, ms] of script) {
    for (let elapsed = 0; elapsed < ms; elapsed += FRAME_MS) {
      const r = vadStep(state, level, FRAME_MS, T);
      state = r.state;
      if (r.opened) events.push("open");
      if (r.closed) events.push("close");
    }
  }
  return { state, events };
}

const LOUD = T.openRms * 2;
const QUIET = 0;

describe("vadStep", () => {
  it("stays shut on silence", () => {
    expect(run([[QUIET, 5000]]).events).toEqual([]);
  });

  it("opens on speech and closes after the hangover, not immediately", () => {
    const { events } = run([
      [LOUD, 500],
      // Half the hangover: a pause between clauses must not end the utterance.
      [QUIET, T.hangoverMs / 2],
      [LOUD, 500],
      [QUIET, T.hangoverMs + 100],
    ]);
    expect(events).toEqual(["open", "close"]);
  });

  it("does not chatter at a level between the two thresholds", () => {
    // The reason for two thresholds. On a single one, a voice sitting here would
    // open and close every few frames and shred one sentence into a dozen
    // transcription requests.
    const between = (T.openRms + T.closeRms) / 2;
    const { events } = run([
      [LOUD, 200],
      [between, 4000],
      [QUIET, T.hangoverMs + 100],
    ]);
    expect(events).toEqual(["open", "close"]);
  });

  it("will not open on a level between the thresholds", () => {
    const between = (T.openRms + T.closeRms) / 2;
    expect(run([[between, 5000]]).events).toEqual([]);
  });

  it("resets the silence counter on every loud frame", () => {
    // Silence must not accumulate across a whole sentence; only a continuous run
    // of it ends an utterance.
    const script: Array<[number, number]> = [[LOUD, 100]];
    for (let i = 0; i < 20; i++) {
      script.push([QUIET, T.hangoverMs - 100], [LOUD, 50]);
    }
    expect(run(script).events).toEqual(["open"]);
  });

  it("caps an utterance that never falls silent, then picks straight back up", () => {
    // A fan or an air conditioner can sit above the close threshold indefinitely.
    // Without the cap the utterance never ends, never gets transcribed, and the
    // feature simply stops responding with no error anywhere.
    //
    // Re-opening on the next frame is the point: a long monologue is segmented
    // rather than truncated, so the audio after the cap is still heard.
    const { events } = run([[LOUD, T.maxUtteranceMs + 1000]]);
    expect(events).toEqual(["open", "close", "open"]);
  });

  it("can open again after closing", () => {
    const { events } = run([
      [LOUD, 300],
      [QUIET, T.hangoverMs + 100],
      [LOUD, 300],
      [QUIET, T.hangoverMs + 100],
    ]);
    expect(events).toEqual(["open", "close", "open", "close"]);
  });

  it("is independent of frame size", () => {
    // The worklet's block size is not ours to choose, so the same audio must give
    // the same transitions whether it arrives in 2 ms or 50 ms frames.
    const transitions = (frameMs: number) => {
      let state = initialVadState();
      const events: string[] = [];
      const play = (level: number, ms: number) => {
        for (let e = 0; e < ms; e += frameMs) {
          const r = vadStep(state, level, frameMs, T);
          state = r.state;
          if (r.opened) events.push("open");
          if (r.closed) events.push("close");
        }
      };
      play(LOUD, 400);
      play(QUIET, T.hangoverMs + 100);
      return events;
    };
    expect(transitions(2)).toEqual(["open", "close"]);
    expect(transitions(50)).toEqual(["open", "close"]);
  });
});

describe("rms", () => {
  it("is zero for silence and for an empty frame", () => {
    expect(rms(new Float32Array(128))).toBe(0);
    expect(rms(new Float32Array(0))).toBe(0);
  });

  it("does not cancel out a symmetric waveform", () => {
    // A plain mean would report silence for this, and the mic would appear dead.
    expect(rms(new Float32Array([1, -1, 1, -1]))).toBe(1);
  });

  it("rises with amplitude", () => {
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5, 6);
  });
});

describe("worthTranscribing", () => {
  it("rejects a click or a keystroke", () => {
    expect(worthTranscribing(0.1 * 16000, 16000, T)).toBe(false);
  });

  it("accepts a short word", () => {
    expect(worthTranscribing(0.5 * 16000, 16000, T)).toBe(true);
  });
});
