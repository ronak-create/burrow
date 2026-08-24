import { describe, expect, it } from "vitest";
import { INK_COLORS, distanceToStroke, inkColor, pathFor, strokeToPath } from "./stroke";
import type { InkStroke } from "../types";

const stroke = (points: Array<[number, number, number]>, size = 6): InkStroke => ({
  id: "s",
  points,
  color: "red",
  size,
});

describe("distanceToStroke — drives the eraser", () => {
  const line = stroke([
    [0, 0, 0.5],
    [100, 0, 0.5],
  ]);

  it("is zero on the stroke itself", () => {
    expect(distanceToStroke(line, 0, 0)).toBeCloseTo(0);
    expect(distanceToStroke(line, 100, 0)).toBeCloseTo(0);
  });

  it("measures perpendicular distance from a segment, not just its endpoints", () => {
    // The midpoint is 50 units from either recorded point but sits on the line.
    // Endpoint-only hit-testing would report 50 here and refuse to erase.
    expect(distanceToStroke(line, 50, 0)).toBeCloseTo(0);
    expect(distanceToStroke(line, 50, 10)).toBeCloseTo(10);
  });

  it("does not project past the ends of a segment", () => {
    // A point beyond the end is measured to the endpoint, not to the infinite line.
    expect(distanceToStroke(line, 130, 0)).toBeCloseTo(30);
  });

  it("handles a single-point dab without dividing by zero", () => {
    const dot = stroke([[10, 10, 0.5]]);
    expect(distanceToStroke(dot, 10, 10)).toBeCloseTo(0);
    expect(distanceToStroke(dot, 13, 14)).toBeCloseTo(5);
  });

  it("handles repeated identical points", () => {
    const stalled = stroke([
      [5, 5, 0.5],
      [5, 5, 0.5],
      [5, 5, 0.5],
    ]);
    expect(Number.isFinite(distanceToStroke(stalled, 5, 5))).toBe(true);
    expect(distanceToStroke(stalled, 8, 9)).toBeCloseTo(5);
  });

  it("finds the closest point on a multi-segment stroke", () => {
    const bent = stroke([
      [0, 0, 0.5],
      [100, 0, 0.5],
      [100, 100, 0.5],
    ]);
    expect(distanceToStroke(bent, 100, 50)).toBeCloseTo(0);
    expect(distanceToStroke(bent, 90, 50)).toBeCloseTo(10);
  });
});

describe("path generation", () => {
  it("produces no path for a degenerate outline", () => {
    // Fewer than four outline points cannot form a shape.
    expect(strokeToPath([])).toBe("");
    expect(strokeToPath([[0, 0], [1, 1], [2, 2]])).toBe("");
  });

  it("produces a closed path for a real stroke", () => {
    const d = pathFor(
      stroke([
        [0, 0, 0.5],
        [10, 4, 0.5],
        [22, 10, 0.5],
        [40, 12, 0.5],
        [60, 8, 0.5],
      ]),
    );
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d).not.toContain("NaN");
  });

  it("survives a stroke that never moved", () => {
    const d = pathFor(stroke([[5, 5, 0.5], [5, 5, 0.5]]));
    expect(d).not.toContain("NaN");
  });
});

describe("inkColor", () => {
  it("resolves palette keys", () => {
    expect(inkColor("red")).toBe(INK_COLORS[0].value);
  });

  it("passes through a raw colour so old boards keep rendering", () => {
    expect(inkColor("#123456")).toBe("#123456");
  });
});
