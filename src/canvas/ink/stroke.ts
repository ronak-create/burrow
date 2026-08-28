import getStroke from "perfect-freehand";
import type { InkStroke } from "../types";

/**
 * Freehand stroke geometry.
 *
 * perfect-freehand turns a raw pointer trail into an outline polygon whose width
 * varies with speed and pressure — that is what makes a stroke read as ink rather
 * than as a polyline. We then render that outline as a filled path.
 */

export const INK_COLORS = [
  { key: "red", value: "#e5484d", label: "Red string" },
  { key: "violet", value: "#7c5cff", label: "Violet" },
  { key: "amber", value: "#e5a13a", label: "Amber" },
  { key: "slate", value: "#8b8b96", label: "Slate" },
] as const;

export const INK_SIZES = [3, 6, 12] as const;

/** Border thickness options for the rectangle/ellipse shape tools, in px. */
export const SHAPE_STROKE_WIDTHS = [1, 2, 4] as const;

/** Tuned for a research board: expressive, but not so springy that arrows wobble. */
const OPTIONS = {
  thinning: 0.55,
  smoothing: 0.55,
  streamline: 0.45,
  easing: (t: number) => t,
  simulatePressure: true,
  last: true,
};

const avg = (a: number, b: number) => (a + b) / 2;

/** Outline points → a smooth closed SVG path. */
export function strokeToPath(points: number[][]): string {
  const len = points.length;
  if (len < 4) return "";

  let a = points[0];
  let b = points[1];
  const c = points[2];

  let d = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(
    2,
  )} ${avg(b[0], c[0]).toFixed(2)},${avg(b[1], c[1]).toFixed(2)} T`;

  for (let i = 2; i < len - 1; i++) {
    a = points[i];
    b = points[i + 1];
    d += `${avg(a[0], b[0]).toFixed(2)},${avg(a[1], b[1]).toFixed(2)} `;
  }
  return `${d}Z`;
}

export function pathFor(stroke: Pick<InkStroke, "points" | "size">): string {
  return strokeToPath(getStroke(stroke.points, { ...OPTIONS, size: stroke.size }) as number[][]);
}

/** Resolve a stored palette key to a CSS colour, tolerating raw values. */
export function inkColor(key: string): string {
  return INK_COLORS.find((c) => c.key === key)?.value ?? key;
}

/**
 * Distance from a point to a stroke, used by the eraser. Compares against the raw
 * input trail rather than the rendered outline — close enough at eraser radius and
 * far cheaper than testing the polygon.
 */
export function distanceToStroke(stroke: InkStroke, x: number, y: number): number {
  let best = Infinity;
  const pts = stroke.points;
  for (let i = 0; i < pts.length; i++) {
    const [px, py] = pts[i];
    // Point distance first — cheap, and enough for single-point dabs.
    best = Math.min(best, Math.hypot(px - x, py - y));
    if (i === 0) continue;
    // Then the segment, so erasing works mid-line on fast strokes with sparse points.
    const [qx, qy] = pts[i - 1];
    const dx = px - qx;
    const dy = py - qy;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) continue;
    let t = ((x - qx) * dx + (y - qy) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(qx + t * dx - x, qy + t * dy - y));
  }
  return best;
}
