import { useEffect, useRef, useState } from "react";
import { create } from "zustand";

/**
 * The listening indicator (spec D).
 *
 * Spec D calls this non-negotiable, and it is right for a reason that is easy to
 * state and easy to get wrong: for an always-listening feature, the interface is
 * the *only* claim the user can check about the microphone. So this component has
 * one job — never be ambiguous about whether the mic is live — and the design
 * follows from that:
 *
 *   - `off` does not animate at all. Not a slower pulse, not a dimmer one. A
 *     resting animation is what a live-but-quiet microphone looks like, so
 *     sharing that vocabulary with the off state would make the two confusable
 *     in exactly the case where confusion matters.
 *   - Every other state moves, and `active` moves *with the user's own voice*.
 *     A pulse on a timer says "something is running"; a shape that answers when
 *     you speak says "this microphone can hear you", which is the actual claim.
 */

export type IndicatorState = "off" | "wake" | "active" | "thinking" | "speaking";

interface Look {
  /** Base radius as a fraction of the box. */
  radius: number;
  /** Wobble depth. */
  amp: number;
  /** Radians per second. */
  speed: number;
  fill: string;
  stroke: string;
  /** Does the live input level drive the shape? */
  reactive: boolean;
}

export const STROKE_WIDTH = 1.5;

/**
 * How far the live level pushes the shape. Both are bounded on purpose: the
 * radius and the wobble are multiplied together, so the loudest possible frame
 * has to still fit inside the box. Overflowing gets silently clipped by the
 * viewBox, and a blob with a flat edge sawn off it looks like a rendering fault
 * rather than like a loud voice.
 *
 * Every state is sized to survive the full gain, not only the reactive one. The
 * smoothed level decays rather than resetting, so the frames just after a loud
 * utterance ends still carry it — and "you stopped talking, now it is thinking"
 * is the single most common transition in the whole feature.
 */
export const LEVEL_RADIUS_GAIN = 0.18;
export const LEVEL_AMP_GAIN = 2.2;

export const LOOKS: Record<IndicatorState, Look> = {
  // Hollow, still, and faint: the shape of a thing that is not running.
  off: { radius: 0.3, amp: 0, speed: 0, fill: "transparent", stroke: "var(--text-faint)", reactive: false },
  // Alive but only half-attending. Slow enough to read as idling rather than
  // working, which is what wake-word-only mode actually is.
  wake: { radius: 0.31, amp: 0.05, speed: 0.7, fill: "var(--accent-wash)", stroke: "var(--accent-line)", reactive: false },
  active: { radius: 0.3, amp: 0.06, speed: 1.6, fill: "var(--accent-wash)", stroke: "var(--accent)", reactive: true },
  thinking: { radius: 0.3, amp: 0.1, speed: 3.4, fill: "var(--accent-wash)", stroke: "var(--accent-dim)", reactive: false },
  speaking: { radius: 0.3, amp: 0.09, speed: 2.4, fill: "var(--accent-wash)", stroke: "var(--accent)", reactive: false },
};

export const INDICATOR_LABEL: Record<IndicatorState, string> = {
  off: "Microphone off",
  wake: "Listening for the wake word",
  active: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
};

/**
 * Typical speech sits far below full scale, so the raw level would barely move
 * the shape. This is the level that reads as "loud".
 */
const FULL_SCALE = 0.25;

/**
 * A closed wobbling blob.
 *
 * Two sine terms at different rates and directions, so the outline never settles
 * into an obviously repeating shape the way a single term does.
 */
export function blobPath(size: number, radius: number, amp: number, phase: number): string {
  const c = size / 2;
  const r = size * radius;
  const points = 64;
  let d = "";
  for (let i = 0; i < points; i++) {
    const t = (i / points) * Math.PI * 2;
    const wobble = Math.sin(3 * t + phase) * 0.6 + Math.sin(5 * t - phase * 1.3) * 0.4;
    const rr = r * (1 + amp * wobble);
    const x = c + rr * Math.cos(t);
    const y = c + rr * Math.sin(t);
    d += `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return `${d}Z`;
}

export default function ListeningIndicator({
  state,
  level = 0,
  size = 28,
  onClick,
  title,
}: {
  state: IndicatorState;
  /** Live input level, 0–1. Only used in `active`. */
  level?: number;
  size?: number;
  onClick?: () => void;
  title?: string;
}) {
  const look = LOOKS[state];
  const [path, setPath] = useState(() => blobPath(size, look.radius, 0, 0));

  // Read once rather than subscribed to: this is a preference, and someone who
  // changes it mid-session can afford a reload.
  const reduceMotion = useRef(
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  ).current;

  const smoothed = useRef(0);

  // Held in a ref so a level update does not restart the animation loop — sixty
  // effect teardowns a second would cost more than the animation does.
  const levelRef = useRef(level);
  levelRef.current = level;

  useEffect(() => {
    // No loop at all when off. The indicator claims the microphone is released,
    // and a component still waking on every frame to say so would be a small lie
    // about the same thing.
    if (state === "off" || reduceMotion) {
      setPath(blobPath(size, look.radius, reduceMotion ? look.amp : 0, 0));
      return;
    }

    let frame = 0;
    let last = performance.now();
    let phase = 0;

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      phase += look.speed * dt;

      // Chases the level rather than tracking it exactly: raw frame-to-frame RMS
      // is jittery enough to look like a fault rather than like speech.
      const target = look.reactive ? Math.min(1, levelRef.current / FULL_SCALE) : 0;
      smoothed.current += (target - smoothed.current) * Math.min(1, dt * 12);

      setPath(
        blobPath(
          size,
          look.radius * (1 + smoothed.current * LEVEL_RADIUS_GAIN),
          look.amp * (1 + smoothed.current * LEVEL_AMP_GAIN),
          phase,
        ),
      );
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, size, reduceMotion]);

  const label = title ?? INDICATOR_LABEL[state];

  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={state !== "off"}
      style={{
        width: size,
        height: size,
        padding: 0,
        borderRadius: "50%",
        background: "transparent",
        border: "none",
        display: "grid",
        placeItems: "center",
        cursor: onClick ? "pointer" : "default",
        flexShrink: 0,
      }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <path
          d={path}
          fill={look.fill}
          stroke={look.stroke}
          strokeWidth={STROKE_WIDTH}
          strokeLinejoin="round"
        />
        {state === "off" && (
          // An explicit strike-through. A faint circle alone reads as "disabled
          // control"; this reads as "microphone off", which is the claim.
          <line
            x1={size * 0.24}
            y1={size * 0.76}
            x2={size * 0.76}
            y2={size * 0.24}
            stroke="var(--text-faint)"
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
          />
        )}
      </svg>
    </button>
  );
}

/**
 * The live input level, kept outside React's tree.
 *
 * The microphone reports fifteen times a second. Routing that through the
 * assistant panel's own state would re-render the transcript, the composer and
 * every message in it at the same rate, to animate one 28-pixel shape. The
 * indicator already redraws each frame, so subscribing only it costs nothing.
 */
interface LevelStore {
  level: number;
  set: (level: number) => void;
}

export const useMicLevel = create<LevelStore>((set) => ({
  level: 0,
  set: (level) => set({ level }),
}));

export function setMicLevel(level: number): void {
  useMicLevel.getState().set(level);
}

/** The indicator, wired to the live level. */
export function LiveListeningIndicator(props: {
  state: IndicatorState;
  size?: number;
  onClick?: () => void;
  title?: string;
}) {
  const level = useMicLevel((s) => s.level);
  return <ListeningIndicator {...props} level={level} />;
}
