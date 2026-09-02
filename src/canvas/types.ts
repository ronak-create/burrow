import type { Edge, Node, Viewport } from "@xyflow/react";

/**
 * Board types.
 *
 * The board is plain JSON and it is exactly three things at once: React Flow's
 * state, the file on disk, and the agent's view of the world. One representation,
 * three uses — so nothing here may hold a class instance, a function, or a
 * circular reference.
 *
 * Note these are `type` aliases, not `interface`s: React Flow requires node data
 * to satisfy `Record<string, unknown>`, and only type aliases get an implicit
 * index signature in TypeScript.
 */

export type BlockKind =
  | "note"
  | "table"
  | "doc"
  | "image"
  | "diagram"
  | "frame"
  | "shape"
  | "text";

/** A temporary "I'm unsure about this" pin the assistant drops (spec D). Never persisted as permanent state. */
export type Marker = "?" | null;

export type NoteData = {
  title: string;
  body: string;
  /** Accent key from the block palette, not a raw CSS colour. */
  color?: string;
  marker?: Marker;
};

export type TableData = {
  title: string;
  columns: string[];
  rows: string[][];
  /** "row,col" -> palette key. Comparison colouring only; no formulas (spec H). */
  cellColors?: Record<string, string>;
  marker?: Marker;
};

export type DocData = {
  title: string;
  /** Path relative to <workspace>/documents/ */
  file: string;
  pageCount?: number;
  marker?: Marker;
};

export type ImageData = {
  title?: string;
  /** Path relative to <workspace>/images/ */
  file: string;
  prompt?: string;
  marker?: Marker;
  /**
   * How the picture is framed inside its block. Absent means fit the whole
   * picture inside the card, which is what every image did before this existed
   * and what every image still does until someone adjusts one.
   *
   * `zoom` is a multiple of the size that just fills the card, and `x`/`y` are
   * percentages naming which part of the picture stays visible — the same pair
   * CSS object-position takes.
   *
   * Deliberately non-destructive: the file in images/ is never rewritten, so a
   * crop can be undone, redone, or reconsidered months later with the original
   * still intact. board.json describes the board; it is not a second copy of
   * your pictures.
   */
  crop?: { zoom: number; x: number; y: number };
};

export type DiagramNode = { id: string; label: string };
export type DiagramEdge = { from: string; to: string; label?: string };

/**
 * A diagram is a self-contained mini-graph rendered inside one card and laid out
 * automatically — not free nodes on the main canvas. The agent emits it
 * declaratively; layout is derived, never stored.
 */
export type DiagramData = {
  title: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  marker?: Marker;
};

/**
 * A bare geometric shape — the rectangle/ellipse of a normal drawing toolbox.
 * Kept as a block rather than an ink object so it inherits selection, resizing and
 * undo from the command layer instead of re-implementing all three.
 */
export type ShapeData = {
  variant: "rectangle" | "ellipse";
  /** Palette key from the ink palette, so shapes and strokes share one set of colours. */
  color?: string;
  /** Border thickness in px. */
  strokeWidth?: number;
  /** Transparent by default: shapes are usually annotation, not fill. */
  filled?: boolean;
  label?: string;
  marker?: Marker;
};

/** Loose text on the canvas, with no card around it. */
export type TextData = {
  text: string;
  size?: number;
  color?: string;
  marker?: Marker;
};

export type FrameData = {
  label: string;
  color?: string;
  marker?: Marker;
  /**
   * Ids this frame actually owns — the blocks that move with it.
   *
   * Membership is explicit rather than geometric. A frame that merely happens to
   * be sitting on top of a block does not own it, because the user did not put it
   * there; a block only joins when it is dragged in, or when the frame is drawn or
   * resized around it. Purely geometric containment meant dropping a frame anywhere
   * silently adopted whatever was underneath, and then dragging the frame hauled
   * unrelated work across the board.
   */
  contains?: string[];
};

export type BlockData =
  | NoteData
  | TableData
  | DocData
  | ImageData
  | DiagramData
  | FrameData
  | ShapeData
  | TextData;

export type NoteBlock = Node<NoteData, "note">;
export type TableBlock = Node<TableData, "table">;
export type DocBlock = Node<DocData, "doc">;
export type ImageBlock = Node<ImageData, "image">;
export type DiagramBlock = Node<DiagramData, "diagram">;
export type FrameBlock = Node<FrameData, "frame">;
export type ShapeBlock = Node<ShapeData, "shape">;
export type TextBlock = Node<TextData, "text">;

export type Block =
  | NoteBlock
  | TableBlock
  | DocBlock
  | ImageBlock
  | DiagramBlock
  | FrameBlock
  | ShapeBlock
  | TextBlock;

export type BoardEdge = Edge;

/** A freehand stroke in absolute canvas coordinates. Tuples are [x, y, pressure]. */
export type InkStroke = {
  id: string;
  points: Array<[number, number, number]>;
  color: string;
  size: number;
};

export type Board = {
  nodes: Block[];
  edges: BoardEdge[];
  ink: InkStroke[];
  viewport: Viewport;
};

export type XY = { x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = XY & Size;

export const emptyBoard = (): Board => ({
  nodes: [],
  edges: [],
  ink: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});

/** Default footprint per block kind, used for placement and containment maths. */
export const DEFAULT_SIZE: Record<BlockKind, Size> = {
  note: { width: 260, height: 180 },
  table: { width: 380, height: 220 },
  doc: { width: 200, height: 150 },
  image: { width: 280, height: 220 },
  diagram: { width: 320, height: 260 },
  frame: { width: 560, height: 380 },
  shape: { width: 200, height: 140 },
  text: { width: 220, height: 44 },
};

export function blockRect(b: Block): Rect {
  const fallback = DEFAULT_SIZE[b.type as BlockKind] ?? DEFAULT_SIZE.note;
  return {
    x: b.position.x,
    y: b.position.y,
    width: b.width ?? b.measured?.width ?? fallback.width,
    height: b.height ?? b.measured?.height ?? fallback.height,
  };
}

/** True when a block's centre sits inside the given rect. Forgiving of overhang. */
export function centreInside(rect: Rect, block: Block): boolean {
  const r = blockRect(block);
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  return cx >= rect.x && cx <= rect.x + rect.width && cy >= rect.y && cy <= rect.y + rect.height;
}

/**
 * Blocks geometrically sitting within a frame's bounds, regardless of ownership.
 * Used when deciding what a frame should *adopt* — never for deciding what moves
 * with it. For that, see `frameMembers`.
 */
export function blocksOverlappingFrame(board: Board, frameId: string): Block[] {
  const frame = board.nodes.find((n) => n.id === frameId);
  if (!frame || frame.type !== "frame") return [];
  const f = blockRect(frame);
  return board.nodes.filter(
    (n) => n.id !== frameId && n.type !== "frame" && centreInside(f, n),
  );
}

/**
 * The blocks a frame actually owns and therefore drags with it. Stale ids (from a
 * deleted block) are filtered out rather than trusted.
 */
export function frameMembers(board: Board, frameId: string): Block[] {
  const frame = board.nodes.find((n) => n.id === frameId);
  if (!frame || frame.type !== "frame") return [];
  const ids = (frame.data as FrameData).contains ?? [];
  if (!ids.length) return [];
  return board.nodes.filter((n) => n.id !== frameId && ids.includes(n.id));
}

/** The frame that currently owns a block, if any. */
export function owningFrame(board: Board, blockId: string): Block | undefined {
  return board.nodes.find(
    (n) => n.type === "frame" && ((n.data as FrameData).contains ?? []).includes(blockId),
  );
}
