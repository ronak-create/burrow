import { DEFAULT_SIZE, emptyBoard, type Block, type BlockKind, type Board } from "./types";

/**
 * Turn whatever is in board.json into a board the canvas can render.
 *
 * The project tells users these are plain files they own and may open in a text
 * editor, so malformed input is a supported situation rather than an impossible
 * one. It also happens without anyone editing anything: a board written by a
 * newer version, a file restored from a partial sync, a disk that filled up
 * mid-write.
 *
 * Loading previously spread the parsed JSON straight over an empty board, so
 * `"nodes": null` replaced the empty array with null and React Flow died on the
 * first `.map()` — a white screen with no way back to the workspace list, from a
 * file the user was invited to edit.
 *
 * The rule here is salvage, not reject: keep every block that can be rendered and
 * drop only what cannot. Losing one malformed node beats losing the board.
 */

const KINDS: BlockKind[] = [
  "note",
  "table",
  "doc",
  "image",
  "diagram",
  "frame",
  "shape",
  "text",
];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown, fallback: number): number {
  // Number.isFinite rejects NaN and Infinity, both of which serialise out of
  // JSON as null but can arrive from a hand-edited file as literal strings.
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function coerceNode(raw: unknown): Block | null {
  if (!isObject(raw)) return null;

  const id = raw.id;
  if (typeof id !== "string" || id === "") return null;

  const type = raw.type;
  if (typeof type !== "string" || !KINDS.includes(type as BlockKind)) return null;

  const pos = isObject(raw.position) ? raw.position : {};
  const size = DEFAULT_SIZE[type as BlockKind];

  return {
    ...raw,
    id,
    type,
    position: { x: num(pos.x, 0), y: num(pos.y, 0) },
    // A block with no size renders as a zero-height sliver that cannot be
    // grabbed, so an unusable size is replaced rather than preserved.
    width: num(raw.width, size.width),
    height: num(raw.height, size.height),
    data: isObject(raw.data) ? raw.data : {},
  } as Block;
}

function coerceStroke(raw: unknown): Board["ink"][number] | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== "string") return null;
  if (!Array.isArray(raw.points)) return null;

  const points = raw.points
    .filter((p): p is unknown[] => Array.isArray(p) && p.length >= 2)
    .map((p) => [num(p[0], 0), num(p[1], 0), num(p[2], 0.5)] as [number, number, number]);
  // A stroke of one point draws nothing; keeping it would just be a phantom in
  // the file that the eraser can never find.
  if (points.length < 2) return null;

  return {
    id: raw.id,
    points,
    color: typeof raw.color === "string" ? raw.color : "slate",
    size: num(raw.size, 3),
  };
}

export function coerceBoard(raw: unknown): Board {
  const base = emptyBoard();
  if (!isObject(raw)) return base;

  const nodes: Block[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.nodes)) {
    for (const candidate of raw.nodes) {
      const node = coerceNode(candidate);
      if (!node) continue;
      // Duplicate ids make React Flow render one node and silently lose the
      // other, and every command that targets the id hits whichever came first.
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      nodes.push(node);
    }
  }

  const edges: Board["edges"] = [];
  const edgeIds = new Set<string>();
  if (Array.isArray(raw.edges)) {
    for (const candidate of raw.edges) {
      if (!isObject(candidate)) continue;
      const { id, source, target } = candidate;
      if (typeof id !== "string" || typeof source !== "string" || typeof target !== "string") {
        continue;
      }
      // An edge to a block that is not here renders as a line to nowhere.
      if (!seen.has(source) || !seen.has(target)) continue;
      if (edgeIds.has(id)) continue;
      edgeIds.add(id);
      edges.push(candidate as Board["edges"][number]);
    }
  }

  const ink: Board["ink"] = [];
  if (Array.isArray(raw.ink)) {
    for (const candidate of raw.ink) {
      const stroke = coerceStroke(candidate);
      if (stroke) ink.push(stroke);
    }
  }

  const vp = isObject(raw.viewport) ? raw.viewport : {};
  const zoom = num(vp.zoom, 1);

  return {
    nodes,
    edges,
    ink,
    viewport: {
      x: num(vp.x, 0),
      y: num(vp.y, 0),
      // A zoom of 0 or a negative one collapses the canvas to nothing visible,
      // which looks identical to an empty board.
      zoom: zoom > 0.01 && zoom < 100 ? zoom : 1,
    },
  };
}

/** How much a load discarded, for telling the user something was wrong. */
export function countDropped(raw: unknown, board: Board): number {
  if (!isObject(raw)) return 0;
  const before =
    (Array.isArray(raw.nodes) ? raw.nodes.length : 0) +
    (Array.isArray(raw.edges) ? raw.edges.length : 0) +
    (Array.isArray(raw.ink) ? raw.ink.length : 0);
  const after = board.nodes.length + board.edges.length + board.ink.length;
  return Math.max(0, before - after);
}
