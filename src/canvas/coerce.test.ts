import { describe, expect, it } from "vitest";
import { coerceBoard, countDropped } from "./coerce";
import { DEFAULT_SIZE } from "./types";

/**
 * board.json is a file the user owns and may open in a text editor, so these are
 * ordinary inputs rather than impossible ones. The rule under test is salvage,
 * not reject: keep everything renderable, drop only what is not.
 */

const node = (over: Record<string, unknown> = {}) => ({
  id: "n1",
  type: "note",
  position: { x: 10, y: 20 },
  width: 260,
  height: 180,
  data: { title: "t", body: "b" },
  ...over,
});

describe("coerceBoard", () => {
  it("returns an empty board for anything that is not an object", () => {
    for (const raw of [null, undefined, 42, "board", [1, 2]]) {
      const b = coerceBoard(raw);
      expect(b.nodes).toEqual([]);
      expect(b.edges).toEqual([]);
      expect(b.ink).toEqual([]);
      expect(b.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    }
  });

  it("survives null collections — the white-screen case", () => {
    // Spreading this over an empty board put null where React Flow calls .map().
    const b = coerceBoard({ nodes: null, edges: null, ink: null, viewport: null });
    expect(b.nodes).toEqual([]);
    expect(b.edges).toEqual([]);
    expect(b.ink).toEqual([]);
    expect(b.viewport.zoom).toBe(1);
  });

  it("keeps good nodes and drops unrenderable ones", () => {
    const b = coerceBoard({
      nodes: [
        node(),
        node({ id: "n2", type: "wormhole" }), // unknown kind
        node({ id: "", type: "note" }), // no id
        node({ id: 7, type: "note" }), // non-string id
        "not an object",
        null,
      ],
    });
    expect(b.nodes.map((n) => n.id)).toEqual(["n1"]);
  });

  it("keeps only the first of a duplicated id", () => {
    // Two nodes with one id renders one and silently loses the other, and every
    // command targeting the id hits whichever came first.
    const b = coerceBoard({
      nodes: [node({ data: { title: "first" } }), node({ data: { title: "second" } })],
    });
    expect(b.nodes).toHaveLength(1);
    expect((b.nodes[0].data as { title: string }).title).toBe("first");
  });

  it("replaces unusable geometry rather than preserving it", () => {
    const b = coerceBoard({
      nodes: [node({ position: null, width: "wide", height: NaN })],
    });
    expect(b.nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(b.nodes[0].width).toBe(DEFAULT_SIZE.note.width);
    expect(b.nodes[0].height).toBe(DEFAULT_SIZE.note.height);
  });

  it("defaults missing node data to an object", () => {
    const b = coerceBoard({ nodes: [node({ data: null })] });
    expect(b.nodes[0].data).toEqual({});
  });

  it("drops edges pointing at blocks that are not here", () => {
    const b = coerceBoard({
      nodes: [node(), node({ id: "n2" })],
      edges: [
        { id: "e1", source: "n1", target: "n2" },
        { id: "e2", source: "n1", target: "ghost" },
        { id: "e3", source: "ghost", target: "n1" },
        { id: "e4", source: "n1" }, // no target
        { source: "n1", target: "n2" }, // no id
        { id: "e1", source: "n2", target: "n1" }, // duplicate id
      ],
    });
    expect(b.edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("drops strokes that would draw nothing", () => {
    const b = coerceBoard({
      ink: [
        { id: "s1", points: [[0, 0, 0.5], [1, 1, 0.5]] },
        { id: "s2", points: [[0, 0, 0.5]] }, // one point draws nothing
        { id: "s3", points: [] },
        { id: "s4", points: null },
        { points: [[0, 0, 0.5], [1, 1, 0.5]] }, // no id
      ],
    });
    expect(b.ink.map((s) => s.id)).toEqual(["s1"]);
    expect(b.ink[0].color).toBe("slate");
    expect(b.ink[0].size).toBe(3);
  });

  it("normalises short and non-numeric stroke points", () => {
    const b = coerceBoard({
      ink: [{ id: "s1", points: [[0, 0], ["x", 5], [2, 2, 0.9]] }],
    });
    // Every surviving point is a full [x, y, pressure] tuple.
    expect(b.ink[0].points).toEqual([[0, 0, 0.5], [0, 5, 0.5], [2, 2, 0.9]]);
  });

  it("replaces a viewport that would render as an empty canvas", () => {
    // A zoom of 0 collapses everything to nothing visible, which is
    // indistinguishable from having lost the board.
    expect(coerceBoard({ viewport: { x: 5, y: 6, zoom: 0 } }).viewport).toEqual({
      x: 5,
      y: 6,
      zoom: 1,
    });
    expect(coerceBoard({ viewport: { x: 0, y: 0, zoom: -2 } }).viewport.zoom).toBe(1);
    expect(coerceBoard({ viewport: { x: 0, y: 0, zoom: 1e6 } }).viewport.zoom).toBe(1);
    expect(coerceBoard({ viewport: { x: 1, y: 2, zoom: 0.5 } }).viewport.zoom).toBe(0.5);
  });

  it("leaves a well-formed board alone", () => {
    const raw = {
      nodes: [node()],
      edges: [{ id: "e1", source: "n1", target: "n1" }],
      ink: [{ id: "s1", points: [[0, 0, 0.5], [1, 1, 0.5]], color: "red", size: 5 }],
      viewport: { x: 3, y: 4, zoom: 2 },
    };
    const b = coerceBoard(raw);
    expect(b.nodes).toHaveLength(1);
    expect(b.edges).toHaveLength(1);
    expect(b.ink).toHaveLength(1);
    expect(b.viewport).toEqual({ x: 3, y: 4, zoom: 2 });
    expect(countDropped(raw, b)).toBe(0);
  });
});

describe("countDropped", () => {
  it("counts what salvage discarded across all three collections", () => {
    const raw = {
      nodes: [node(), node({ id: "n2", type: "wormhole" })],
      edges: [{ id: "e1", source: "n1", target: "ghost" }],
      ink: [{ id: "s1", points: [[0, 0, 0.5]] }],
    };
    // One bad node, one dangling edge, one degenerate stroke.
    expect(countDropped(raw, coerceBoard(raw))).toBe(3);
  });

  it("never reports a negative count", () => {
    expect(countDropped(null, coerceBoard(null))).toBe(0);
    expect(countDropped({ nodes: "nope" }, coerceBoard({ nodes: "nope" }))).toBe(0);
  });
});
