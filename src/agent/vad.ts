/**
 * Voice activity detection.
 *
 * The wake word is served by running Whisper locally rather than by a dedicated
 * engine (see the milestone 5 log), and the whole feasibility of that rests on
 * this file. Transcribing continuously would keep a model resident and busy for
 * every second the app is open, which on a laptop is a battery decision the user
 * did not agree to. Instead the mic stays open, an energy detector runs over it
 * for approximately nothing, and Whisper is woken only for audio that contains
 * speech.
 *
 * Deliberately energy-based rather than a neural VAD. A neural detector is more
 * accurate in noise, but it is a second model to ship and load — the exact cost
 * this design exists to avoid. The failure mode of getting it wrong is also mild:
 * a false positive costs one short transcription that matches no wake phrase, and
 * a false negative costs the user saying the wake word twice.
 *
 * Everything here is pure so it can be tested, and so that `listener.ts` can
 * stringify it into an AudioWorklet without maintaining a second copy.
 *
 * That imposes a real constraint: **`rms` and `vadStep` may not reference any
 * module-level binding**, including each other. `String(fn)` returns the function
 * after bundling, where an outside reference has been renamed to something that
 * does not exist inside the worklet — and since minification only happens in a
 * production build, breaking this rule fails in the shipped app and nowhere else.
 */

export interface VadTuning {
  /** Level at which speech is considered started. */
  openRms: number;
  /** Level below which speech is considered to have stopped. */
  closeRms: number;
  /** Silence tolerated inside one utterance before it is considered finished. */
  hangoverMs: number;
  /** Audio kept from before the trigger, so the first phoneme is not clipped. */
  prerollMs: number;
  /** Shorter than this is a cough, a door, or a keystroke — not a sentence. */
  minUtteranceMs: number;
  /** Hard cap, so a noisy room cannot buffer without bound. */
  maxUtteranceMs: number;
}

/**
 * Thresholds are in RMS of normalised float samples, so they are independent of
 * bit depth. The two differ on purpose: a single threshold makes a voice hovering
 * at the boundary open and close many times a second, shredding one sentence into
 * a dozen transcription requests.
 */
/**
 * Measured, 30 Aug 2026: across ten synthesized utterances the 90th-percentile
 * frame sat at 0.143–0.183 RMS and peaks reached 0.197–0.273, so `openRms` has
 * roughly seven times' headroom under real speech and every file opened and
 * closed exactly once. That rules out the threshold being too *high*.
 *
 * It does not rule out the opposite. Those samples came from a speech
 * synthesiser: clean, level, and with no room behind them. A real microphone in
 * a real room is quieter and noisier, so if these need moving it will be upward,
 * to stop the detector waking on the room itself.
 */
export const VAD_DEFAULTS: VadTuning = {
  openRms: 0.02,
  closeRms: 0.012,
  // Long enough to survive the pause between clauses. Too short and "Hey Burrow —
  // add a note about Redis" arrives as two utterances, with the command half
  // stripped of the wake word that authorised it.
  hangoverMs: 700,
  // A trigger can only fire after enough signal has arrived to cross the
  // threshold, which is always after the word has started. Without pre-roll the
  // recording begins mid-wake-word and the match fails on the word it was
  // listening for.
  prerollMs: 400,
  minUtteranceMs: 250,
  maxUtteranceMs: 15000,
}

export interface VadState {
  speaking: boolean;
  /** Silence accumulated since the level last dropped below `closeRms`. */
  quietMs: number;
  /** Length of the utterance in progress. */
  voicedMs: number;
}

export function initialVadState(): VadState {
  return { speaking: false, quietMs: 0, voicedMs: 0 };
}

export interface VadResult {
  state: VadState;
  /** Speech just started: begin an utterance, including the pre-roll. */
  opened: boolean;
  /** Speech just ended, or the cap was hit: the utterance is ready. */
  closed: boolean;
}

/**
 * Advance the detector by one frame.
 *
 * `dtMs` is the frame's duration rather than wall-clock, so the machine behaves
 * identically at any sample rate or block size — and can be driven by a test
 * without waiting in real time.
 */
export function vadStep(state: VadState, rms: number, dtMs: number, t: VadTuning): VadResult {
  if (!state.speaking) {
    if (rms < t.openRms) return { state, opened: false, closed: false };
    return { state: { speaking: true, quietMs: 0, voicedMs: dtMs }, opened: true, closed: false };
  }

  const voicedMs = state.voicedMs + dtMs;
  // Loud frames reset the silence counter rather than adding to it, so a pause
  // between words does not accumulate across the whole sentence.
  const quietMs = rms >= t.closeRms ? 0 : state.quietMs + dtMs;

  // The cap closes an utterance even mid-speech. A room with a fan in it can sit
  // above the close threshold indefinitely, and an utterance that never ends is
  // one that never gets transcribed — the feature would simply stop responding.
  //
  // Closing returns to the idle state, so the very next loud frame opens a fresh
  // utterance. A long monologue is therefore segmented rather than truncated.
  if (quietMs >= t.hangoverMs || voicedMs >= t.maxUtteranceMs) {
    // Written out rather than calling initialVadState(), per the note at the top
    // of this file: an outside reference would not survive being stringified.
    return { state: { speaking: false, quietMs: 0, voicedMs: 0 }, opened: false, closed: true };
  }
  return { state: { speaking: true, quietMs, voicedMs }, opened: false, closed: false };
}

/** Root mean square of a frame of normalised samples. */
export function rms(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

/**
 * Is a finished utterance worth transcribing?
 *
 * Applied after the fact rather than as a threshold during capture, because the
 * length is only known once it has closed.
 */
export function worthTranscribing(samples: number, sampleRate: number, t: VadTuning): boolean {
  return (samples / sampleRate) * 1000 >= t.minUtteranceMs;
}
