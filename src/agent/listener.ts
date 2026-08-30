import { transcribe } from "./voice";
import { encodeWav, resample, TARGET_RATE } from "../providers/stt/wav";
import { rms, VAD_DEFAULTS, vadStep, worthTranscribing, type VadTuning } from "./vad";

/**
 * The always-on microphone.
 *
 * One stream, one `AudioWorklet`, and Whisper woken only for audio that contains
 * speech. The worklet runs the detector on the audio thread and posts one message
 * per utterance rather than a stream of frames — posting every frame to the main
 * thread would reintroduce, as message traffic, exactly the continuous cost this
 * design exists to avoid.
 *
 * The processor source is built by stringifying the tested functions from
 * `vad.ts`, so there is one implementation of the detector rather than a copy
 * living in a string that drifts from the one with tests against it.
 */

const PROCESSOR = "burrow-vad";

/** Level updates per second. Enough for a smooth indicator, few enough to ignore. */
const LEVEL_HZ = 15;

/**
 * More than this many utterances waiting means transcription is slower than the
 * user is talking — a small local model on a busy machine. Refusing the newest is
 * the least bad option: the alternative is replying to something said a minute ago.
 */
const MAX_PENDING = 3;

/**
 * Consecutive transcription failures before the listener gives up.
 *
 * The case this exists for: always-on listening is switched on while the local
 * Whisper server is not running. Nothing about that is detectable up front —
 * the endpoint is configured, it simply does not answer — so every utterance
 * fails. Without a limit the microphone stays open indefinitely, achieving
 * nothing, while a fresh error stacks up for every sentence spoken near it.
 */
const MAX_FAILURES = 3;

export interface ListenerHandlers {
  /** Current input level, 0–1, for the indicator. */
  onLevel?(level: number): void;
  /** A finished utterance, transcribed. Never called with empty text. */
  onUtterance(text: string): void;
  onError?(error: unknown): void;
  /**
   * The listener shut itself down and the microphone is released. The caller has
   * to reflect that, or the indicator goes on claiming to listen.
   */
  onStopped?(reason: Error): void;
}

export class ContinuousListener {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private failures = 0;

  get running(): boolean {
    return this.ctx !== null;
  }

  async start(handlers: ListenerHandlers, tuning: VadTuning = VAD_DEFAULTS): Promise<void> {
    if (this.running) return;

    // Bounded for the same reason hold-to-talk is: in WebView2 an unprepared
    // getUserMedia neither resolves nor rejects, and the UI would sit on
    // "listening" forever with the microphone in an unknown state.
    this.stream = await Promise.race([
      navigator.mediaDevices.getUserMedia({
        // Echo cancellation is load-bearing here rather than a nicety: the
        // assistant speaks its replies through the same speakers this microphone
        // is open in front of.
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Microphone did not respond. Check Windows mic permissions.")),
          8000,
        ),
      ),
    ]);

    try {
      // Asking for the rate Whisper wants lets the browser resample in native
      // code and usually removes the step entirely. It is a request, not a
      // guarantee, so the real rate is read back and handled either way.
      this.ctx = new AudioContext({ sampleRate: TARGET_RATE });
      const rate = this.ctx.sampleRate;

      const url = URL.createObjectURL(new Blob([workletSource()], { type: "text/javascript" }));
      try {
        await this.ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }

      this.node = new AudioWorkletNode(this.ctx, PROCESSOR, {
        numberOfOutputs: 0,
        processorOptions: {
          tuning,
          sampleRate: rate,
          levelEvery: Math.max(1, Math.round(rate / 128 / LEVEL_HZ)),
        },
      });

      this.node.port.onmessage = (e: MessageEvent) => {
        const msg = e.data as { type: string; level?: number; samples?: Float32Array };
        if (msg.type === "level") return handlers.onLevel?.(msg.level ?? 0);
        if (msg.type === "utterance" && msg.samples) {
          this.enqueue(msg.samples, rate, tuning, handlers);
        }
      };

      this.ctx.createMediaStreamSource(this.stream).connect(this.node);
    } catch (e) {
      // A half-started listener still holds the microphone, and the operating
      // system would show it as live with nothing in the app admitting to it.
      this.stop();
      throw e;
    }
  }

  /**
   * Transcribe in order, one at a time.
   *
   * Utterances can close faster than a local model answers, and letting them race
   * would deliver commands out of the order they were spoken — which, for an
   * assistant that edits a board, is not a cosmetic problem.
   */
  private enqueue(
    samples: Float32Array,
    rate: number,
    tuning: VadTuning,
    handlers: ListenerHandlers,
  ): void {
    if (!worthTranscribing(samples.length, rate, tuning)) return;
    if (this.pending >= MAX_PENDING) {
      handlers.onError?.(
        new Error("Speech is arriving faster than it can be transcribed; some was dropped."),
      );
      return;
    }

    this.pending++;
    this.queue = this.queue
      .then(async () => {
        // Only reached when the browser declined the requested context rate.
        const mono = rate === TARGET_RATE ? samples : resample(samples, rate, TARGET_RATE);
        const wav = encodeWav(mono, TARGET_RATE);
        const text = await transcribe(
          new Blob([wav as BlobPart], { type: "audio/wav" }),
          "audio/wav",
        );
        // Silence and room noise transcribe to nothing, or to a lone piece of
        // punctuation. Neither is worth waking the state machine for.
        this.failures = 0;
        if (text.trim()) handlers.onUtterance(text);
      })
      .catch((e) => {
        this.failures++;
        if (this.failures >= MAX_FAILURES) {
          const reason = new Error(
            `Always-on listening stopped: speech could not be transcribed. ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
          this.stop();
          handlers.onStopped?.(reason);
          return;
        }
        // Only the first failure of a run is surfaced. Reporting each one would
        // stack an identical error for every sentence spoken in the room.
        if (this.failures === 1) handlers.onError?.(e);
      })
      .finally(() => {
        this.pending--;
      });
  }

  /**
   * Release everything. Spec D's manual toggle is a *hard* off, so the tracks are
   * stopped rather than muted — stopping them is what turns the operating
   * system's microphone indicator off, and that indicator is the only claim about
   * the microphone the user can actually check.
   */
  stop(): void {
    try {
      this.node?.disconnect();
      this.node?.port.close();
    } catch {
      /* already torn down */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => {});
    this.node = null;
    this.stream = null;
    this.ctx = null;
    this.pending = 0;
    this.failures = 0;
    this.queue = Promise.resolve();
  }
}

/**
 * The worklet, assembled from the functions in `vad.ts`.
 *
 * `String(fn)` is deliberate. The alternative is a second copy of the detector
 * written inline in this template, which would be the copy that actually runs
 * while the tested one sits beside it quietly diverging. See the note at the top
 * of `vad.ts` for the constraint this places on those two functions.
 *
 * Exported so the test can run it. A string of generated code that nothing ever
 * parses is a string that is wrong.
 */
export function workletSource(): string {
  return `
const rms = ${String(rms)};
const vadStep = ${String(vadStep)};

class BurrowVad extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.t = o.tuning;
    this.rate = o.sampleRate;
    this.levelEvery = o.levelEvery;
    this.state = { speaking: false, quietMs: 0, voicedMs: 0 };
    this.preMax = Math.ceil((this.rate * this.t.prerollMs) / 1000);
    this.pre = [];
    this.preLen = 0;
    this.buf = [];
    this.collecting = false;
    this.ticks = 0;
    this.peak = 0;
  }

  flatten(frames) {
    let total = 0;
    for (const f of frames) total += f.length;
    const out = new Float32Array(total);
    let at = 0;
    for (const f of frames) { out.set(f, at); at += f.length; }
    return out;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;

    const level = rms(ch);
    const dtMs = (ch.length / this.rate) * 1000;

    this.peak = Math.max(this.peak, level);
    if (++this.ticks >= this.levelEvery) {
      this.port.postMessage({ type: "level", level: this.peak });
      this.ticks = 0;
      this.peak = 0;
    }

    const r = vadStep(this.state, level, dtMs, this.t);
    this.state = r.state;

    if (r.opened) {
      // Seed with the audio from before the trigger. A detector can only fire
      // once enough signal has arrived to cross the threshold, which is always
      // after the word began — without this, the recording starts mid-wake-word
      // and the match fails on the one word it was listening for.
      this.collecting = true;
      this.buf = this.pre.slice();
    }
    if (this.collecting) this.buf.push(ch.slice());
    if (r.closed) {
      const samples = this.flatten(this.buf);
      // Transferred rather than copied: this is the audio thread.
      this.port.postMessage({ type: "utterance", samples }, [samples.buffer]);
      this.collecting = false;
      this.buf = [];
    }

    // Appended after use, so the pre-roll holds only frames strictly older than
    // the one that opened the utterance and no audio is counted twice.
    this.pre.push(ch.slice());
    this.preLen += ch.length;
    while (this.pre.length > 1 && this.preLen - this.pre[0].length >= this.preMax) {
      this.preLen -= this.pre.shift().length;
    }

    return true;
  }
}

registerProcessor(${JSON.stringify(PROCESSOR)}, BurrowVad);
`;
}
