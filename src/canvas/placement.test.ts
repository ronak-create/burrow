import { describe, expect, it } from "vitest";
import { boundsOf, findFreeSpot, isFree } from "./placement";
import { isSparse, boardView } from "./serialize";
import { blockRect, emptyBoard, type Block, type Board } from "./types";

const note = (id: string, x: number, y: number, w = 260, h = 180): Block =>
  ({
    id,
    type: "note",
    position: { x, y },
    width: w,
    height: h,
    data: { title: id, body: "" },
  }) as Block;

const frame = (id: string, x: number, y: number, w: number, h: number): Block =>
  ({ id, type: "frame", position: { x, y }, width: w, height: h, data: { label: id } }) as Block;

/** A frame that explicitly owns the given blocks. */
const frameWith = (id: string, x: number, y: number, w: number, h: number, contains: string[]): Block =>
  ({ id, type: "frame", position: { x, y }, width: w, height: h, data: { label: id, contains } }) as Block;

const boardWith = (...nodes: Block[]): Board => ({ ...emptyBoard(), nodes });

describe("findFreeSpot", () => {
  it("uses the anchor when the board is empty", () => {
    const spot = findFreeSpot(emptyBoard(), { width: 260, height: 180 }, { x: 500, y: 400 });
    // Anchor is the centre of the new block, so the top-left is offset by half.
    expect(spot).toEqual({ x: 370, y: 310 });
  });

  it("never returns a spot that overlaps an existing block", () => {
    // A tight cluster around the anchor: every nearby slot is taken.
    const board = boardWith(
      note("a", 0, 0),
      note("b", 300, 0),
      note("c", 0, 220),
      note("d", 300, 220),
      note("e", 150, 110),
    );
    const size = { width: 260, height: 180 };
    const spot = findFreeSpot(board, size, { x: 150, y: 110 });
    expect(isFree(board, { ...spot, ...size })).toBe(true);
  });

  it("keeps producing non-overlapping spots as blocks accumulate", () => {
    // This is the property that matters: the assistant adding note after note
    // must never bury the user's work.
    let board = emptyBoard();
    const size = { width: 260, height: 180 };
    for (let i = 0; i < 15; i++) {
      const spot = findFreeSpot(board, size, { x: 0, y: 0 });
      expect(isFree(board, { ...spot, ...size })).toBe(true);
      board = { ...board, nodes: [...board.nodes, note(`n${i}`, spot.x, spot.y)] };
    }
    expect(board.nodes).toHaveLength(15);
  });

  it("treats frames as backdrops, not obstacles", () => {
    // Landing inside a frame is normal and usually intended.
    const board = boardWith(frame("f", -500, -500, 1000, 1000));
    const size = { width: 260, height: 180 };
    const spot = findFreeSpot(board, size, { x: 0, y: 0 });
    expect(spot).toEqual({ x: -130, y: -90 });
  });
});

describe("boundsOf", () => {
  it("encloses the named blocks with padding", () => {
    const board = boardWith(note("a", 0, 0, 200, 100), note("b", 400, 300, 200, 100));
    const r = boundsOf(board, ["a", "b"], 20)!;
    expect(r.x).toBe(-20);
    expect(r.y).toBe(-32); // extra headroom for the frame's label bar
    expect(r.x + r.width).toBe(620);
    expect(r.y + r.height).toBe(420);
  });

  it("returns null when no ids match", () => {
    expect(boundsOf(boardWith(note("a", 0, 0)), ["nope"])).toBeNull();
  });
});

describe("isSparse — gates whether the assistant may frame without asking", () => {
  it("is sparse when nearly empty", () => {
    expect(isSparse(emptyBoard())).toBe(true);
    expect(isSparse(boardWith(note("a", 0, 0), note("b", 300, 0)))).toBe(true);
  });

  it("is not sparse once there is real work", () => {
    expect(
      isSparse(boardWith(note("a", 0, 0), note("b", 300, 0), note("c", 600, 0), note("d", 900, 0))),
    ).toBe(false);
  });

  it("is not sparse when hand-drawn ink exists, however few blocks", () => {
    const board: Board = {
      ...boardWith(note("a", 0, 0)),
      ink: [{ id: "s1", points: [[0, 0, 0.5]], color: "red", size: 3 }],
    };
    expect(isSparse(board)).toBe(false);
  });

  it("ignores frames when judging emptiness", () => {
    expect(isSparse(boardWith(frame("f1", 0, 0, 100, 100), frame("f2", 0, 0, 100, 100)))).toBe(true);
  });
});

describe("boardView — what the assistant sees", () => {
  // "member" is owned by the frame; "squatter" merely sits within its bounds.
  const board = boardWith(
    frameWith("f", -40, -40, 700, 470, ["member"]),
    note("member", 10, 30),
    note("squatter", 300, 30),
    note("outside", 10, 900),
  );

  it("reports owned members, not whatever happens to sit inside the bounds", () => {
    // The assistant's notion of a group must match what actually moves together,
    // or it will describe relationships the board does not have.
    const view = boardView({ ...board, edges: [] });
    expect(view.frames[0].contains).toEqual(["member"]);
    expect(view.blocks.find((b) => b.id === "member")?.inFrame).toBe("f");
    expect(view.blocks.find((b) => b.id === "squatter")?.inFrame).toBeUndefined();
    expect(view.blocks.find((b) => b.id === "outside")?.inFrame).toBeUndefined();
  });

  it("renders connections with readable endpoints, not bare ids", () => {
    const view = boardView({
      ...board,
      edges: [{ id: "e1", source: "inside", target: "outside", label: "supports" }],
    });
    expect(view.connections[0]).toContain("supports");
    expect(view.connections[0]).toContain("inside");
  });

  it("warns about ink it cannot read", () => {
    const withInk: Board = {
      ...board,
      ink: [{ id: "s1", points: [[0, 0, 1]], color: "red", size: 2 }],
    };
    expect(boardView(withInk).note).toMatch(/hand-drawn/i);
  });

  it("falls back to default sizes when a block has none", () => {
    const sizeless = { id: "x", type: "note", position: { x: 0, y: 0 }, data: { title: "", body: "" } } as Block;
    expect(blockRect(sizeless)).toEqual({ x: 0, y: 0, width: 260, height: 180 });
  });
});
