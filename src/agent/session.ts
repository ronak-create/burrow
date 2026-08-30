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
}

export interface SessionConfig {
  /** Comma-separated; any one of them wakes it. */
  wakePhrases: string;
  /** Idle period before dropping back to wake-word-only. */
  idleSleepMs: number;
}

export type SessionEvent =
  | { type: "enable" }
  | { type: "disable" }
  /** A finished utterance, as transcribed. */
  | { type: "heard"; text: string }
  | { type: "tick"; dtMs: number }
  | { type: "busy"; value: boolean };

export interface SessionResult {
  state: SessionState;
  /** Text to hand to the agent as a turn, if this event produced one. */
  command?: string;
  /** The wake phrase was just recognised — for the indicator and the chime. */
  woke?: boolean;
  /** Dropped back to wake-word-only through idleness. */
  slept?: boolean;
}

export function initialSession(): SessionState {
  return { mode: "off", idleMs: 0, busy: false };
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
        ? { state: { mode: "wake", idleMs: 0, busy: false } }
        : { state };

    case "disable":
      return { state: initialSession() };

    case "busy":
      // Leaving busy resets the idle clock. The user has just been listening to a
      // reply, and counting that time against them would sleep the assistant at
      // the exact moment they are most likely to answer it.
      return {
        state: { ...state, busy: event.value, idleMs: event.value ? state.idleMs : 0 },
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
      if (state.mode === "off" || state.busy) return { state };

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
