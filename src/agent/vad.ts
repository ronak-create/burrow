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
 * It did not rule out the opposite, and the opposite turned out to be true.
 *
 * Measured again 2 Sep 2026, this time on a real microphone in a real room. At
 * 0.020 the detector opened on the room itself: three segments in one short test,
 * two of which were silence that whisper filled in with "Thank you." At 0.050 the
 * same voice in the same room produced exactly one segment, transcribed correctly
 * and completely, with no spurious opens at all.
 *
 * So 0.050 is the anchor now — a number a microphone produced, replacing a number
 * a speech synthesiser produced. `closeRms` keeps the same 0.6 ratio, which is
 * what stopped a voice at the boundary from shredding one sentence into a dozen
 * requests.
 *
 * One room, one microphone: better evidence than SAPI, not proof for every
 * machine. The scale still spans 0.016 to 0.126, and moving it is one slider.
 */
export const VAD_DEFAULTS: VadTuning = {
  openRms: 0.05,
  closeRms: 0.03,
  // Long enough to survive the pause between clauses. Too short and "Hey Burrow —
  // add a note about Redis" arrives as two utterances, with the command half
  // stripped of the wake word that authorised it.
  hangoverMs: 700,
  // A trigger can only fire after enough signal has arrived to cross the
  // threshold, which is always after the word has started. Without pre-roll the
  // recording begins mid-wake-word and the match fails on the word it was
  // listening for.
  prerollMs: 400,
  // Raised from 250 on 2 Sep 2026. A live microphone opened on room noise twice
  // in one short test and whisper turned both fragments into "Thank you." — the
  // shorter the segment, the more of it whisper invents. Nothing the wake phrase
  // needs is lost: "hey burrow" alone runs past 600ms, and pre-roll is added to
  // whatever the detector captured.
  minUtteranceMs: 400,
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

/**
 * Thresholds adjusted by a user-facing sensitivity, 1–10.
 *
 * The defaults above were measured against a speech synthesiser, which is clean,
 * level, and has no room behind it. A real microphone in a real room is neither,
 * and the gap between those two is not something this code can know — it depends
 * on the microphone, the room, and how far away the person sits.
 *
 * So there is a knob. A level meter that shows a voice never crossing the line,
 * with no way to move the line, is a diagnosis without a cure.
 *
 * 5 is the measured default. Each step is a third of an octave, which spans
 * roughly 0.006–0.05 RMS end to end: quiet enough for a distant laptop
 * microphone at 10, deaf enough to ignore a loud room at 1.
 */
export function tuningFor(sensitivity: number, base: VadTuning = VAD_DEFAULTS): VadTuning {
  const clamped = Math.min(10, Math.max(1, sensitivity));
  const scale = Math.pow(2, (5 - clamped) / 3);
  return { ...base, openRms: base.openRms * scale, closeRms: base.closeRms * scale };
}
