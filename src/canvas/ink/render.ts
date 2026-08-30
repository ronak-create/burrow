import { blockRect, type Block, type Board, type InkStroke, type Rect } from "../types";
import { pathFor } from "./stroke";

/**
 * Rendering freehand ink for the assistant to look at (spec F).
 *
 * The structured board view carries everything except this. A note has a title
 * and a body; a diagram has nodes and edges; a stroke has a list of coordinates,
 * and no amount of describing coordinates tells a model that they form an arrow,
 * a circle around two cards, or the word "no". `boardView` has therefore always
 * reported ink as a bare count — the assistant could tell that drawing existed
 * and nothing whatever about it.
 *
 * Spec F reserved vision for exactly this and nothing else. It is a fallback, not
 * the perception path: a picture of a table is strictly worse than the table, and
 * costs far more. So this renders the ink, plus enough of the structured board to
 * locate it, and nothing else.
 *
 * Including the blocks is the part that is easy to leave out and wrong to. An
 * arrow drawn from one card to another is *about* those two cards; rendered
 * alone it is a diagonal line, and the model would confidently describe a
 * diagonal line.
 */

/** Cap on the rendered image's longest side. */
export const MAX_DIMENSION = 1024;

/** Breathing room around the strokes, in board units. */
const PADDING = 32;

/** Blocks further than this outside the ink are context nobody asked for. */
const CONTEXT_MARGIN = 120;

/** Room above a block for the caption carrying its id. */
const CAPTION_HEIGHT = 24;

/**
 * How far context may enlarge the picture, per axis.
 *
 * The region has to grow to fit the blocks it draws, or their captions fall
 * outside the viewBox and are cropped — which is the whole failure this bound is
 * balancing against. But it cannot grow without limit either: one large frame
 * near the ink would expand the picture until the drawing itself was a few pixels
 * across. Three times the ink keeps the ink legible.
 */
const MAX_CONTEXT_GROWTH = 3;

const esc = (s: string) =>
  s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

/** The region a set of strokes occupies, padded. Null when there is no ink. */
export function inkBounds(strokes: InkStroke[], padding = PADDING): Rect | null {
  const points = strokes.flatMap((s) => s.points);
  if (points.length === 0) return null;

  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs) - padding;
  const y = Math.min(...ys) - padding;
  return {
    x,
    y,
    width: Math.max(1, Math.max(...xs) + padding - x),
    height: Math.max(1, Math.max(...ys) + padding - y),
  };
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function intersects(a: Rect, b: Rect, margin = 0): boolean {
  return !(
    a.x > b.x + b.width + margin ||
    a.x + a.width < b.x - margin ||
    a.y > b.y + b.height + margin ||
    a.y + a.height < b.y - margin
  );
}

/** Blocks close enough to the ink to be what it is about. */
function nearbyBlocks(board: Board, ink: Rect): Block[] {
  return board.nodes.filter((n) => intersects(ink, blockRect(n), CONTEXT_MARGIN));
}

/**
 * The region to draw: the ink, grown to fit the blocks it is about.
 *
 * Framing on the ink alone is the obvious thing and it is wrong. An arrow drawn
 * from one card to another has a bounding box that is *between* the two cards and
 * touches neither, so both captions — the ids the model is asked to quote back —
 * land outside the picture. Observed, not theorised: the first render of exactly
 * that case produced a red arrow between two anonymous dashed edges.
 */
export function sketchRegion(board: Board, padding = PADDING): Rect | null {
  const ink = inkBounds(board.ink, padding);
  if (!ink) return null;

  let grown = ink;
  for (const block of nearbyBlocks(board, ink)) {
    const r = blockRect(block);
    grown = union(grown, {
      x: r.x,
      y: r.y - CAPTION_HEIGHT,
      width: r.width,
      height: r.height + CAPTION_HEIGHT,
    });
  }

  // Clamp each axis, keeping the ink centred so it stays the subject.
  const width = Math.min(grown.width, ink.width * MAX_CONTEXT_GROWTH);
  const height = Math.min(grown.height, ink.height * MAX_CONTEXT_GROWTH);
  const cx = ink.x + ink.width / 2;
  const cy = ink.y + ink.height / 2;
  return {
    x: Math.min(Math.max(grown.x, cx - width / 2), grown.x + grown.width - width),
    y: Math.min(Math.max(grown.y, cy - height / 2), grown.y + grown.height - height),
    width,
    height,
  };
}

/** A short label for a block, for the caption drawn on its outline. */
function labelOf(block: Block): string {
  const d = block.data as Record<string, unknown>;
  const text = (d.title as string) || (d.label as string) || (d.text as string) || "";
  return text.length > 34 ? `${text.slice(0, 34)}…` : text;
}

/**
 * An SVG of the ink over outlines of the blocks near it.
 *
 * Blocks are drawn as labelled rectangles rather than in full. The model is being
 * asked what the *drawing* means; re-rendering a note's body into the picture
 * would spend tokens on text it already has, in a form it reads less reliably.
 */
export function sketchSvg(board: Board, region: Rect): string {
  const nearby = nearbyBlocks(board, region);

  const blocks = nearby
    .map((n) => {
      const r = blockRect(n);
      const label = labelOf(n);
      // The id goes in the picture on purpose: it is how the model refers back to
      // the block in a later tool call, and guessing from a title is unreliable.
      const caption = label ? `${n.id} · ${label}` : n.id;
      return (
        `<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" ` +
        `fill="none" stroke="#9aa0a6" stroke-width="2" stroke-dasharray="6 4" rx="8"/>` +
        `<text x="${r.x + 6}" y="${r.y - 6}" font-family="sans-serif" font-size="14" ` +
        `fill="#5f6368">${esc(caption)}</text>`
      );
    })
    .join("");

  const ink = board.ink
    .map((s) => {
      const d = pathFor(s);
      return d ? `<path d="${d}" fill="${esc(s.color)}"/>` : "";
    })
    .join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(region.width)}" ` +
    `height="${Math.round(region.height)}" ` +
    `viewBox="${region.x} ${region.y} ${region.width} ${region.height}">` +
    // Opaque, because a transparent PNG composites onto black in some viewers and
    // dark ink on black is not a picture of anything.
    `<rect x="${region.x}" y="${region.y}" width="${region.width}" height="${region.height}" fill="#ffffff"/>` +
    blocks +
    ink +
    `</svg>`
  );
}

/** Longest-side-capped output size for a region. Never upscales. */
export function outputSize(region: Rect, max = MAX_DIMENSION): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(region.width, region.height));
  return {
    width: Math.max(1, Math.round(region.width * scale)),
    height: Math.max(1, Math.round(region.height * scale)),
  };
}

/**
 * SVG → PNG, as raw base64.
 *
 * Vision endpoints take raster images; none of them take SVG. Going through an
 * `Image` and a canvas keeps the rasteriser the browser's problem. The SVG has no
 * external references, so the canvas is never tainted and `toDataURL` succeeds.
 */
export async function rasterise(svg: string, width: number, height: number): Promise<string> {
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The sketch could not be rendered."));
    img.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The sketch could not be rendered: no 2D canvas context.");
  ctx.drawImage(image, 0, 0, width, height);

  return canvas.toDataURL("image/png").split(",")[1] ?? "";
}

/** Render the board's ink to a PNG the assistant can be shown. */
export async function renderInk(
  board: Board,
): Promise<{ base64: string; region: Rect; blocksShown: number } | null> {
  const region = sketchRegion(board);
  if (!region) return null;

  const { width, height } = outputSize(region);
  const svg = sketchSvg(board, region);
  const blocksShown = nearbyBlocks(board, region).length;

  return { base64: await rasterise(svg, width, height), region, blocksShown };
}
