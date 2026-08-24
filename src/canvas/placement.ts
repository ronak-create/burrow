import { blockRect, type Board, type Rect, type Size, type XY } from "./types";

/**
 * Where the assistant puts things.
 *
 * Spec F says the assistant proposes placement rather than deciding silently, and
 * must never drop content on top of existing work. So: scan outward from a
 * preferred anchor and take the first genuinely empty rectangle. On an empty board
 * that lands at the anchor; on a busy board it drifts to the edge of the cluster,
 * which is the "put it on the boundary for the user to position" behaviour.
 */

const GAP = 28;

function overlaps(a: Rect, b: Rect, gap = GAP): boolean {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

/** Frames are backdrops — landing inside one is fine and usually intended. */
function obstacles(board: Board): Rect[] {
  return board.nodes.filter((n) => n.type !== "frame").map(blockRect);
}

export function isFree(board: Board, rect: Rect): boolean {
  return !obstacles(board).some((o) => overlaps(rect, o));
}

/**
 * Square-spiral outward from `anchor` until an empty slot appears. Steps by the
 * block's own footprint so results line up into rough rows and columns instead of
 * scattering.
 */
export function findFreeSpot(board: Board, size: Size, anchor: XY = { x: 0, y: 0 }): XY {
  const start = { x: anchor.x - size.width / 2, y: anchor.y - size.height / 2 };
  if (isFree(board, { ...start, ...size })) return start;

  const stepX = size.width + GAP;
  const stepY = size.height + GAP;

  for (let ring = 1; ring <= 12; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        // Only the perimeter of each ring; the interior was covered already.
        if (Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
        const candidate = { x: start.x + dx * stepX, y: start.y + dy * stepY, ...size };
        if (isFree(board, candidate)) return { x: candidate.x, y: candidate.y };
      }
    }
  }

  // Board is unusually dense — fall back to just right of everything.
  const all = obstacles(board);
  if (!all.length) return start;
  const right = Math.max(...all.map((r) => r.x + r.width));
  const top = Math.min(...all.map((r) => r.y));
  return { x: right + GAP, y: top };
}

/** Centre of everything on the board — a sensible anchor when nothing else is specified. */
export function boardCentre(board: Board): XY {
  const rects = board.nodes.map(blockRect);
  if (!rects.length) return { x: 0, y: 0 };
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.width));
  const y2 = Math.max(...rects.map((r) => r.y + r.height));
  return { x: (x + x2) / 2, y: (y + y2) / 2 };
}

/** A rectangle that encloses the given blocks, padded — used when framing a cluster. */
export function boundsOf(board: Board, ids: string[], pad = 32): Rect | null {
  const rects = board.nodes.filter((n) => ids.includes(n.id)).map(blockRect);
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x)) - pad;
  const y = Math.min(...rects.map((r) => r.y)) - pad - 12; // extra room for the label bar
  const x2 = Math.max(...rects.map((r) => r.x + r.width)) + pad;
  const y2 = Math.max(...rects.map((r) => r.y + r.height)) + pad;
  return { x, y, width: x2 - x, height: y2 - y };
}
