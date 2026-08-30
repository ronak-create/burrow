import { describe, expect, it, vi } from "vitest";
import { VAD_DEFAULTS } from "./vad";

// The listener pulls in the transcription stack, which reaches Tauri. None of
// that is under test here — the worklet is.
vi.mock("./voice", () => ({ transcribe: async () => "" }));

const { workletSource } = await import("./listener");

/**
 * The worklet is generated code: the detector from `vad.ts` is stringified into
 * a blob and handed to the audio thread. That is the kind of construction that
 * type-checks, bundles, and then throws a ReferenceError in the one context no
 * test ever enters — so this test enters it, by running the generated source
 * against stubs and driving real frames through the processor.
 *
 * It also enforces the rule at the top of `vad.ts`. Executing the source in an
 * isolated scope means any reference the stringified functions make to a
 * module-level binding is a ReferenceError here, which is the same property that
 * keeps them safe from being renamed by a production build.
 */

const RATE = 16000;
const QUANTUM = 128;
const FRAME_MS = (QUANTUM / RATE) * 1000;

interface Posted {
  type: string;
  level?: number;
  samples?: Float32Array;
}

/** Execute the generated worklet and return an instantiated processor. */
function loadProcessor(levelEvery = 8) {
  const posted: Posted[] = [];
  const port = {
    postMessage: (msg: Posted) => posted.push(msg),
    close: () => {},
  };

  class FakeProcessor {
    port = port;
  }

  type ProcessorClass = new (o: unknown) => { process(inputs: Float32Array[][]): boolean };
  const registered: ProcessorClass[] = [];

  // Only the two stubs are in scope. Anything else the generated source reaches
  // for does not exist, which is exactly the failure this test is here to catch.
  new Function("AudioWorkletProcessor", "registerProcessor", workletSource())(
    FakeProcessor,
    (_name: string, cls: ProcessorClass) => registered.push(cls),
  );

  if (registered.length !== 1) throw new Error("the worklet registered no processor");
  const processor = new registered[0]({
    processorOptions: { tuning: VAD_DEFAULTS, sampleRate: RATE, levelEvery },
  });
  return { processor, posted };
}

function frame(level: number): Float32Array[][] {
  const buf = new Float32Array(QUANTUM);
  // Alternating so the RMS equals the amplitude, matching how a real waveform
  // reads rather than a DC offset the detector would never see.
  for (let i = 0; i < QUANTUM; i++) buf[i] = i % 2 === 0 ? level : -level;
  return [[buf]];
}

function play(
  processor: { process(i: Float32Array[][]): boolean },
  level: number,
  ms: number,
): void {
  for (let elapsed = 0; elapsed < ms; elapsed += FRAME_MS) processor.process(frame(level));
}

const LOUD = VAD_DEFAULTS.openRms * 3;
const SILENT = 0;

describe("the generated worklet", () => {
  it("parses, registers, and runs with nothing but the two stubs in scope", () => {
    const { processor } = loadProcessor();
    expect(processor.process(frame(SILENT))).toBe(true);
  });

  it("posts nothing but levels while the room is quiet", () => {
    const { processor, posted } = loadProcessor();
    play(processor, SILENT, 3000);

    expect(posted.some((m) => m.type === "utterance")).toBe(false);
    expect(posted.some((m) => m.type === "level")).toBe(true);
  });

  it("emits exactly one utterance for one stretch of speech", () => {
    const { processor, posted } = loadProcessor();
    play(processor, SILENT, 600);
    play(processor, LOUD, 800);
    play(processor, SILENT, VAD_DEFAULTS.hangoverMs + 200);

    const utterances = posted.filter((m) => m.type === "utterance");
    expect(utterances).toHaveLength(1);
  });

  it("includes pre-roll, so the wake word is not clipped off the front", () => {
    // The whole reason pre-roll exists: the detector can only fire once enough
    // signal has arrived to cross the threshold, which is always after the word
    // started. Without this the audio begins mid-wake-word and never matches.
    const { processor, posted } = loadProcessor();
    play(processor, SILENT, 1500);
    play(processor, LOUD, 500);
    play(processor, SILENT, VAD_DEFAULTS.hangoverMs + 200);

    const samples = posted.find((m) => m.type === "utterance")?.samples;
    const prerollSamples = (VAD_DEFAULTS.prerollMs / 1000) * RATE;
    const speechSamples = 0.5 * RATE;

    expect(samples).toBeDefined();
    expect(samples!.length).toBeGreaterThanOrEqual(prerollSamples + speechSamples);
  });

  it("does not let pre-roll grow without bound over a long silence", () => {
    // The buffer is retained forever while nothing is said. If it were not
    // trimmed, an app left open would accumulate the whole session in memory.
    const { processor, posted } = loadProcessor();
    play(processor, SILENT, 20000);
    play(processor, LOUD, 200);
    play(processor, SILENT, VAD_DEFAULTS.hangoverMs + 200);

    const samples = posted.find((m) => m.type === "utterance")!.samples!;
    const prerollSamples = (VAD_DEFAULTS.prerollMs / 1000) * RATE;
    // Pre-roll, the speech, the hangover, and at most one frame of slack.
    const ceiling = prerollSamples + (0.2 + VAD_DEFAULTS.hangoverMs / 1000) * RATE + QUANTUM * 2;
    expect(samples.length).toBeLessThanOrEqual(ceiling);
  });

  it("separates two sentences into two utterances", () => {
    const { processor, posted } = loadProcessor();
    for (let i = 0; i < 2; i++) {
      play(processor, LOUD, 400);
      play(processor, SILENT, VAD_DEFAULTS.hangoverMs + 200);
    }
    expect(posted.filter((m) => m.type === "utterance")).toHaveLength(2);
  });

  it("keeps one sentence whole across a pause between clauses", () => {
    const { processor, posted } = loadProcessor();
    play(processor, LOUD, 400);
    play(processor, SILENT, VAD_DEFAULTS.hangoverMs / 2);
    play(processor, LOUD, 400);
    play(processor, SILENT, VAD_DEFAULTS.hangoverMs + 200);

    // Splitting here would strip the command half of "Hey Burrow — add a note"
    // from the wake word that authorised it.
    expect(posted.filter((m) => m.type === "utterance")).toHaveLength(1);
  });

  it("reports a level that tracks the input", () => {
    const { processor, posted } = loadProcessor(1);
    play(processor, SILENT, 100);
    const quiet = posted.filter((m) => m.type === "level").pop()!.level!;

    play(processor, LOUD, 100);
    const loud = posted.filter((m) => m.type === "level").pop()!.level!;

    // The indicator is spec D's non-negotiable: it has to move when the mic
    // hears something, or it is decoration rather than a claim about the mic.
    expect(quiet).toBeLessThan(loud);
    expect(loud).toBeGreaterThan(VAD_DEFAULTS.openRms);
  });

  it("survives an input with no channels", () => {
    // Happens between a device change and the stream reconnecting; throwing on
    // the audio thread would kill the processor for the rest of the session.
    const { processor } = loadProcessor();
    expect(processor.process([[]])).toBe(true);
    expect(processor.process([])).toBe(true);
  });
});
