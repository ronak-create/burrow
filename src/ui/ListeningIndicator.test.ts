import { describe, expect, it } from "vitest";
import {
  blobPath,
  LEVEL_AMP_GAIN,
  LEVEL_RADIUS_GAIN,
  LOOKS,
  STROKE_WIDTH,
  type IndicatorState,
} from "./ListeningIndicator";

/**
 * The indicator is spec D's one non-negotiable, so the geometry it draws should
 * not be able to degenerate quietly. A path that collapses to a point or leaks
 * outside its box would read as the microphone being off, which is the single
 * thing this component exists not to get wrong.
 */

const SIZE = 28;

function points(d: string): Array<[number, number]> {
  return [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

describe("blobPath", () => {
  it("emits a closed path", () => {
    const d = blobPath(SIZE, 0.3, 0.1, 0);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(points(d).length).toBeGreaterThan(32);
  });

  it("is a circle when there is no wobble", () => {
    const c = SIZE / 2;
    const r = SIZE * 0.3;
    for (const [x, y] of points(blobPath(SIZE, 0.3, 0, 0))) {
      expect(Math.hypot(x - c, y - c)).toBeCloseTo(r, 1);
    }
  });

  it("keeps every state inside its box at full voice, stroke included", () => {
    // Reads the real configuration rather than numbers typed out again here, so
    // retuning a state cannot quietly push it past the viewBox. Overflow is
    // clipped silently, and a blob with a flat edge sawn off it looks like a
    // rendering fault rather than like a loud voice.
    const half = STROKE_WIDTH / 2;

    for (const state of Object.keys(LOOKS) as IndicatorState[]) {
      const look = LOOKS[state];
      const radius = look.radius * (1 + LEVEL_RADIUS_GAIN);
      const amp = look.amp * (1 + LEVEL_AMP_GAIN);

      // Sweep the phase: the widest excursion does not land at any one angle.
      for (let phase = 0; phase < Math.PI * 2; phase += 0.2) {
        for (const [x, y] of points(blobPath(SIZE, radius, amp, phase))) {
          expect(Math.min(x, y), `${state} at phase ${phase.toFixed(1)}`).toBeGreaterThanOrEqual(
            half,
          );
          expect(Math.max(x, y), `${state} at phase ${phase.toFixed(1)}`).toBeLessThanOrEqual(
            SIZE - half,
          );
        }
      }
    }
  });

  it("moves as the phase advances, and repeats over a full turn", () => {
    const at = (phase: number) => blobPath(SIZE, 0.3, 0.1, phase);
    expect(at(0)).not.toBe(at(0.7));
    expect(at(0)).toBe(at(Math.PI * 2 * 10));
  });

  it("never collapses to a point", () => {
    const c = SIZE / 2;
    for (const [x, y] of points(blobPath(SIZE, 0.3, 0.9, 2))) {
      expect(Math.hypot(x - c, y - c)).toBeGreaterThan(0);
    }
  });
});
