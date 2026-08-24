import { describe, expect, it } from "vitest";
import { apply, invert, type Command } from "./commands";
import { emptyBoard, type Block, type Board, type BoardEdge, type InkStroke } from "./types";

const note = (id: string, x = 0, y = 0, extra: Record<string, unknown> = {}): Block =>
  ({
    id,
    type: "note",
    position: { x, y },
    data: { title: `note ${id}`, body: "", ...extra },
  }) as Block;

const frame = (id: string, x = 0, y = 0): Block =>
  ({ id, type: "frame", position: { x, y }, data: { label: "Frame" } }) as Block;

const edge = (id: string, source: string, target: string): BoardEdge => ({ id, source, target });

const stroke = (id: string): InkStroke => ({
  id,
  points: [
    [0, 0, 0.5],
    [10, 10, 0.6],
  ],
  color: "red",
  size: 4,
});

/** Apply, then apply the inverse, and assert we are exactly back where we started. */
function roundTrips(before: Board, cmd: Command) {
  const inv = invert(before, cmd);
  const after = apply(before, cmd);
  const restored = inv ? apply(after, inv) : after;
  expect(restored).toEqual(before);
  return { after, inv };
}

describe("apply / invert round-trip", () => {
  const populated: Board = {
    ...emptyBoard(),
    nodes: [note("a", 10, 20), note("b", 300, 40, { color: "violet" }), frame("f")],
    edges: [edge("e1", "a", "b")],
    ink: [stroke("s1")],
  };

  it("addBlock", () => {
    roundTrips(populated, { t: "addBlock", block: note("c") });
  });

  it("removeBlock restores the block and every edge that touched it", () => {
    const { after } = roundTrips(populated, { t: "removeBlock", id: "a" });
    // Deleting a block must not leave a dangling edge behind.
    expect(after.edges).toHaveLength(0);
    expect(after.nodes.map((n) => n.id)).toEqual(["b", "f"]);
  });

  it("moveBlock", () => {
    roundTrips(populated, { t: "moveBlock", id: "a", position: { x: 999, y: -50 } });
  });

  it("resizeBlock", () => {
    roundTrips(populated, { t: "resizeBlock", id: "a", size: { width: 400, height: 300 } });
  });

  it("updateBlock restores changed values", () => {
    roundTrips(populated, { t: "updateBlock", id: "b", patch: { color: "green" } });
  });

  it("updateBlock removes keys that did not exist before", () => {
    const { after } = roundTrips(populated, { t: "updateBlock", id: "a", patch: { color: "blue" } });
    expect((after.nodes[0].data as Record<string, unknown>).color).toBe("blue");
  });

  it("connect / disconnect", () => {
    roundTrips(populated, { t: "connect", edge: edge("e2", "b", "a") });
    roundTrips(populated, { t: "disconnect", edgeId: "e1" });
  });

  it("setMarker on and off", () => {
    const flagged = apply(populated, { t: "setMarker", id: "a", marker: "?" });
    roundTrips(populated, { t: "setMarker", id: "a", marker: "?" });
    roundTrips(flagged, { t: "setMarker", id: "a", marker: null });
  });

  it("addInk / removeInk", () => {
    roundTrips(populated, { t: "addInk", stroke: stroke("s2") });
    roundTrips(populated, { t: "removeInk", strokeId: "s1" });
  });

  it("batch undoes as one step, in reverse order", () => {
    const cmd: Command = {
      t: "batch",
      label: "add two connected notes",
      commands: [
        { t: "addBlock", block: note("x", 0, 0) },
        { t: "addBlock", block: note("y", 100, 0) },
        { t: "connect", edge: edge("ex", "x", "y") },
      ],
    };
    const { after } = roundTrips(populated, cmd);
    expect(after.nodes).toHaveLength(5);
    expect(after.edges).toHaveLength(2);
  });

  it("nested batch round-trips", () => {
    roundTrips(populated, {
      t: "batch",
      label: "outer",
      commands: [
        { t: "addBlock", block: note("p") },
        {
          t: "batch",
          label: "inner",
          commands: [
            { t: "moveBlock", id: "a", position: { x: 1, y: 1 } },
            { t: "removeBlock", id: "b" },
          ],
        },
      ],
    });
  });
});

describe("undo preserves order", () => {
  // Array order is render/z order, so an undo that reorders is a visibly wrong undo.
  const b: Board = {
    ...emptyBoard(),
    nodes: [note("a"), note("b"), note("c")],
    edges: [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "a", "c")],
    ink: [stroke("s1"), stroke("s2"), stroke("s3")],
  };

  it("restores a deleted middle block to its original index", () => {
    const { after } = roundTrips(b, { t: "removeBlock", id: "b" });
    expect(after.nodes.map((n) => n.id)).toEqual(["a", "c"]);
  });

  it("restores a deleted middle edge to its original index", () => {
    roundTrips(b, { t: "disconnect", edgeId: "e2" });
  });

  it("restores a deleted middle stroke to its original index", () => {
    roundTrips(b, { t: "removeInk", strokeId: "s2" });
  });

  it("restores both block and edge order when deleting a connected block", () => {
    // "b" sits mid-list and owns two mid-list edges — the worst case for ordering.
    roundTrips(b, { t: "removeBlock", id: "b" });
  });
});

describe("no-op safety", () => {
  it("commands targeting a missing block do not throw and invert to null", () => {
    const b = emptyBoard();
    for (const cmd of [
      { t: "moveBlock", id: "ghost", position: { x: 1, y: 1 } },
      { t: "updateBlock", id: "ghost", patch: { title: "x" } },
      { t: "removeBlock", id: "ghost" },
      { t: "setMarker", id: "ghost", marker: "?" },
      { t: "disconnect", edgeId: "ghost" },
      { t: "removeInk", strokeId: "ghost" },
    ] as Command[]) {
      expect(invert(b, cmd)).toBeNull();
      expect(apply(b, cmd)).toEqual(b);
    }
  });

  it("re-adding an existing block is idempotent", () => {
    const b: Board = { ...emptyBoard(), nodes: [note("a")] };
    const cmd: Command = { t: "addBlock", block: note("a", 500, 500) };
    expect(apply(b, cmd).nodes).toHaveLength(1);
    // A retried agent call must not be undoable into deleting the original.
    expect(invert(b, cmd)).toBeNull();
  });
});

describe("unified undo stack (spec C)", () => {
  it("restores exact state across interleaved user and agent edits", () => {
    // Mirrors the real store: push {cmd, inverse} as each edit lands, whoever made it.
    const history: Array<{ cmd: Command; inv: Command | null }> = [];
    const snapshots: Board[] = [];

    let board: Board = emptyBoard();
    const run = (cmd: Command) => {
      snapshots.push(board);
      history.push({ cmd, inv: invert(board, cmd) });
      board = apply(board, cmd);
    };

    run({ t: "addBlock", block: note("u1", 0, 0) }); // user
    run({ t: "addBlock", block: note("a1", 200, 0) }); // agent
    run({ t: "moveBlock", id: "u1", position: { x: 50, y: 50 } }); // user
    run({ t: "connect", edge: edge("e1", "u1", "a1") }); // agent
    run({ t: "updateBlock", id: "a1", patch: { body: "from the assistant" } }); // agent
    run({ t: "removeBlock", id: "u1" }); // user

    expect(board.nodes).toHaveLength(1);

    // Unwind everything, newest first, and check each step lands on its snapshot.
    for (let i = history.length - 1; i >= 0; i--) {
      const { inv } = history[i];
      if (inv) board = apply(board, inv);
      expect(board).toEqual(snapshots[i]);
    }

    expect(board).toEqual(emptyBoard());
  });
});
