import { matchAnyWake } from "./wake";

/**
 * The listening state machine (spec D).
 *
 * Three modes, and the distinction between the first two is the whole point of
 * the feature: `off` means the microphone stream is released, not merely ignored.
 * Spec D calls for a manual toggle that is a *hard* off, and a toggle that only
 * stops acting on audio while still holding the mic open would be a lie told by
 * the user interface about the microphone — the one lie an always-listening
 * product cannot afford.
 *
 * A pure reducer, because every interesting behaviour here is a timing rule and
 * timing rules tested by waiting are tests nobody runs. The audio and the timers
 * live in `listener.ts`; what any given event means lives here.
 */

export type Mode = "off" | "wake" | "active";

export interface SessionState {
  mode: Mode;
  /** Time since the user last said something, while active. */
  idleMs: number;
  /** The assistant is thinking or speaking. Capture is ignored throughout. */
  busy: boolean;
  /** True while the reply is being spoken — the only time the app makes noise. */
  speaking: boolean;
  /**
   * Audio captured before this instant is not trusted.
   *
   * Ignoring capture *while* busy is not enough, and the gap is not theoretical:
   * a segment recorded through the assistant's own reply is transcribed
   * asynchronously, and whisper takes seconds, so it arrives after the reply has
   * finished and the session is idle again. On 2 Sep 2026 that fed a sentence of
   * the assistant's own answer back in as a command. The guard has to be about
   * when the audio was *captured*, not when its text turned up.
   */
  deafUntil: number;
}

/**
 * How long after the speakers fall silent capture stays untrusted.
 *
 * Covers the tail: the status flips when the utterance ends, not when the last
 * of it has left the room, and a reverberant room adds more. The cost is that a
 * user talking over the very end of a reply is not heard, which is the cheaper
 * mistake — the alternative is the assistant answering itself.
 */
const ECHO_TAIL_MS = 600;

/**
 * Phrases that stop a turn in progress.
 *
 * Matched whole and exactly, unlike the wake phrase: a stop word is used at the
 * moment of frustration and must not misfire on a sentence that merely contains
 * "stop". Only heard while the assistant is thinking — while it is *speaking*
 * the microphone is hearing the assistant, and a stop word recognised out of the
 * app's own voice would cut it off mid-sentence for no reason.
 */
const CANCELS = new Set(["stop", "stop it", "cancel", "cancel that", "never mind", "nevermind"]);

const isCancel = (text: string) =>
  CANCELS.has(
    text
      .toLowerCase()
      .replace(/[.,!?;:…"'’“”-]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );

export interface SessionConfig {
  /** Comma-separated; any one of them wakes it. */
  wakePhrases: string;
  /** Idle period before dropping back to wake-word-only. */
  idleSleepMs: number;
}

export type SessionEvent =
  | { type: "enable" }
  | { type: "disable" }
  /**
   * A finished utterance, as transcribed. `capturedAt` is when the *audio*
   * started, not when the text arrived — see `deafUntil`.
   */
  | { type: "heard"; text: string; capturedAt?: number }
  | { type: "tick"; dtMs: number }
  | { type: "busy"; value: boolean; at?: number; speaking?: boolean };

export interface SessionResult {
  state: SessionState;
  /** Text to hand to the agent as a turn, if this event produced one. */
  command?: string;
  /** The wake phrase was just recognised — for the indicator and the chime. */
  woke?: boolean;
  /** Dropped back to wake-word-only through idleness. */
  slept?: boolean;
  /** The user asked, out loud, for the turn in progress to stop. */
  cancel?: boolean;
}

export function initialSession(): SessionState {
  return { mode: "off", idleMs: 0, busy: false, speaking: false, deafUntil: 0 };
}

export function sessionStep(
  state: SessionState,
  event: SessionEvent,
  cfg: SessionConfig,
): SessionResult {
  switch (event.type) {
    case "enable":
      // Enabling never jumps straight to active. Turning the microphone on is not
      // the same as addressing the assistant, and starting in active would mean
      // the first thing said after flipping the switch is treated as a command.
      return state.mode === "off"
        ? { state: { ...initialSession(), mode: "wake" } }
        : { state };

    case "disable":
      return { state: initialSession() };

    case "busy":
      // Leaving busy resets the idle clock. The user has just been listening to a
      // reply, and counting that time against them would sleep the assistant at
      // the exact moment they are most likely to answer it.
      return {
        state: {
          ...state,
          busy: event.value,
          speaking: event.value ? (event.speaking ?? state.speaking) : false,
          idleMs: event.value ? state.idleMs : 0,
          // Only the trailing edge sets it: the microphone is untrusted for a
          // moment after the room goes quiet, not after it starts making noise.
          deafUntil: event.value ? state.deafUntil : (event.at ?? 0) + ECHO_TAIL_MS,
        },
      };

    case "tick": {
      if (state.mode !== "active" || state.busy) return { state };
      const idleMs = state.idleMs + event.dtMs;
      if (idleMs < cfg.idleSleepMs) return { state: { ...state, idleMs } };
      return { state: { ...state, mode: "wake", idleMs: 0 }, slept: true };
    }

    case "heard": {
      // Anything captured while the assistant is thinking or speaking is
      // discarded. Echo cancellation is not perfect, and a reply spoken through
      // the speakers that contains the app's own name would otherwise wake it —
      // and, worse, be handed back to it as a command.
      if (state.mode === "off") return { state };

      if (state.busy) {
        // Thinking, and told to stop. Nothing is coming out of the speakers, so
        // this is the user and not an echo of the assistant.
        if (!state.speaking && isCancel(event.text)) return { state, cancel: true };
        return { state };
      }

      // Captured while the assistant was talking, delivered after it stopped.
      // This is the assistant's own voice arriving late; it is not a command.
      if (event.capturedAt !== undefined && event.capturedAt < state.deafUntil) return { state };

      const match = matchAnyWake(event.text, cfg.wakePhrases);

      if (state.mode === "wake") {
        if (!match.hit) return { state };
        // The rest of the same breath is the command: "Hey Burrow, add a note"
        // is one sentence, and waking without acting on it would make the user
        // say everything twice.
        return {
          state: { ...state, mode: "active", idleMs: 0 },
          woke: true,
          ...(match.rest ? { command: match.rest } : {}),
        };
      }

      // Already active. The wake phrase is stripped if it was used anyway, since
      // people keep saying it out of habit and it is not part of the request.
      const text = (match.hit ? match.rest : event.text).trim();
      return { state: { ...state, idleMs: 0 }, ...(text ? { command: text } : {}) };
    }
  }
}

/** Is the microphone stream meant to be open in this state? */
export function micLive(state: SessionState): boolean {
  return state.mode !== "off";
}
