import {
  blockRect,
  frameMembers,
  type Block,
  type Board,
  type DiagramData,
  type DocData,
  type ImageData,
  type NoteData,
  type TableData,
  type FrameData,
  type Rect,
  type ShapeData,
  type Size,
  type TextData,
} from "./types";

/**
 * The assistant's view of the board.
 *
 * This is the default perception path (spec F): precise, cheap, and structured, so
 * the assistant reasons about what is actually there instead of guessing from a
 * picture. Vision is the fallback for hand-drawn ink alone, which has no
 * structured form to read — `read_sketch` renders it, and the count reported here
 * is what tells the model there is anything to render.
 *
 * Two things matter here. Keep it compact — this goes into every turn's context.
 * And describe *relationships*, not just contents: which blocks sit inside which
 * frame, and what connects to what, because that is the part a flat node list
 * loses and the part the user means when they say "the one next to it".
 */

const MAX_BODY = 600;
const MAX_CELL = 60;
const MAX_ROWS = 12;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…[truncated]` : s);

function summarise(b: Block): Record<string, unknown> {
  switch (b.type) {
    case "note": {
      const d = b.data as NoteData;
      return { title: d.title, body: clip(d.body ?? "", MAX_BODY) };
    }
    case "table": {
      const d = b.data as TableData;
      const rows = d.rows.slice(0, MAX_ROWS).map((r) => r.map((c) => clip(c ?? "", MAX_CELL)));
      return {
        title: d.title,
        columns: d.columns,
        rows,
        ...(d.rows.length > MAX_ROWS ? { omittedRows: d.rows.length - MAX_ROWS } : {}),
      };
    }
    case "doc": {
      const d = b.data as DocData;
      // Contents are not inlined here — the assistant calls read_document when it
      // actually needs the text, so a board full of papers stays cheap to perceive.
      return { title: d.title, file: d.file, pageCount: d.pageCount };
    }
    case "image": {
      const d = b.data as ImageData;
      return { title: d.title, file: d.file, prompt: d.prompt };
    }
    case "diagram": {
      const d = b.data as DiagramData;
      return {
        title: d.title,
        nodes: d.nodes.map((n) => n.label),
        edges: d.edges.map((e) => {
          const from = d.nodes.find((n) => n.id === e.from)?.label ?? e.from;
          const to = d.nodes.find((n) => n.id === e.to)?.label ?? e.to;
          return e.label ? `${from} -[${e.label}]-> ${to}` : `${from} -> ${to}`;
        }),
      };
    }
    case "frame": {
      const d = b.data as FrameData;
      return { label: d.label };
    }
    case "shape": {
      const d = b.data as ShapeData;
      return { variant: d.variant, ...(d.label ? { label: d.label } : {}) };
    }
    case "text": {
      const d = b.data as TextData;
      return { text: clip(d.text ?? "", MAX_BODY) };
    }
  }
}

export interface BoardView {
  blockCount: number;
  bounds: { x: number; y: number; width: number; height: number } | null;
  /** Ids the user has selected right now. What "this one" refers to. */
  selection: string[];
  /** The part of the board on screen, in board coordinates. Null if unknown. */
  visible: { x: number; y: number; width: number; height: number } | null;
  blocks: Array<Record<string, unknown>>;
  frames: Array<Record<string, unknown>>;
  connections: string[];
  inkStrokes: number;
  note?: string;
}

/**
 * What the user can see, from the stored viewport and the size of the canvas.
 *
 * React Flow's viewport is a translation and a scale applied to the board, so the
 * visible region is the inverse of that over the canvas rectangle. Screen size is
 * passed in rather than read here, because this module is pure — it is also
 * stringified into a worklet's sibling and tested in node, where there is no DOM.
 */
function visibleRect(board: Board, screen: Size | null | undefined) {
  if (!screen || !screen.width || !screen.height) return null;
  const { x, y, zoom } = board.viewport;
  if (!zoom) return null;
  // `|| 0` because a viewport at the origin rounds to -0, which is a real value
  // that fails an equality check and reads as "-0" to anyone debugging this.
  return {
    x: Math.round(-x / zoom) || 0,
    y: Math.round(-y / zoom) || 0,
    width: Math.round(screen.width / zoom),
    height: Math.round(screen.height / zoom),
  };
}

const intersects = (a: Rect, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export function boardView(board: Board, screen?: Size | null): BoardView {
  const visible = visibleRect(board, screen);
  const loose = board.nodes.filter((n) => n.type !== "frame");
  const frames = board.nodes.filter((n) => n.type === "frame");

  // Which blocks each frame owns. Reported from explicit membership, so the
  // assistant's idea of a group matches what actually moves together.
  const contained = new Map<string, string>();
  const frameViews = frames.map((f) => {
    const inside = frameMembers(board, f.id);
    inside.forEach((b) => contained.set(b.id, f.id));
    const r = blockRect(f);
    return {
      id: f.id,
      label: (f.data as FrameData).label,
      at: [Math.round(r.x), Math.round(r.y)],
      size: [Math.round(r.width), Math.round(r.height)],
      contains: inside.map((b) => b.id),
      ...(f.selected ? { selected: true } : {}),
      ...(visible && !intersects(r, visible) ? { offScreen: true } : {}),
    };
  });

  const blocks = loose.map((b) => {
    const r = blockRect(b);
    return {
      id: b.id,
      kind: b.type,
      at: [Math.round(r.x), Math.round(r.y)],
      size: [Math.round(r.width), Math.round(r.height)],
      ...(contained.has(b.id) ? { inFrame: contained.get(b.id) } : {}),
      ...((b.data as { marker?: string }).marker ? { flagged: true } : {}),
      // Both are omitted when false so the common case stays compact: most boards
      // have nothing selected and most blocks are on screen.
      ...(b.selected ? { selected: true } : {}),
      ...(visible && !intersects(r, visible) ? { offScreen: true } : {}),
      ...summarise(b),
    };
  });

  const label = (id: string) => {
    const n = board.nodes.find((x) => x.id === id);
    if (!n) return id;
    const d = n.data as Record<string, unknown>;
    const text = (d.title as string) || (d.label as string) || "";
    return text ? `${id} ("${clip(text, 40)}")` : id;
  };

  const connections = board.edges.map((e) =>
    e.label ? `${label(e.source)} -[${e.label}]-> ${label(e.target)}` : `${label(e.source)} -> ${label(e.target)}`,
  );

  let bounds: BoardView["bounds"] = null;
  if (board.nodes.length) {
    const rects = board.nodes.map(blockRect);
    const x = Math.min(...rects.map((r) => r.x));
    const y = Math.min(...rects.map((r) => r.y));
    const x2 = Math.max(...rects.map((r) => r.x + r.width));
    const y2 = Math.max(...rects.map((r) => r.y + r.height));
    bounds = { x: Math.round(x), y: Math.round(y), width: Math.round(x2 - x), height: Math.round(y2 - y) };
  }

  return {
    blockCount: board.nodes.length,
    bounds,
    selection: board.nodes.filter((n) => n.selected).map((n) => n.id),
    visible,
    blocks,
    frames: frameViews,
    connections,
    inkStrokes: board.ink.length,
    ...(board.ink.length
      ? { note: "This board has hand-drawn strokes. They are not readable as structured data — call read_sketch to see them, or ask the user. Do not reason about them from this count alone." }
      : {}),
  };
}

/** Compact JSON for the prompt. */
export function serializeBoard(board: Board, screen?: Size | null): string {
  return JSON.stringify(boardView(board, screen));
}

/**
 * Is the board sparse enough that the assistant may add a frame without asking?
 * On a board with real work on it, framing is a reorganisation and needs consent
 * (spec C) — never silently rearrange someone's in-progress thinking.
 */
export function isSparse(board: Board): boolean {
  return board.nodes.filter((n) => n.type !== "frame").length <= 3 && board.ink.length === 0;
}
