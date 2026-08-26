import { describe, expect, it } from "vitest";
import {
  blockRect,
  blocksOverlappingFrame,
  centreInside,
  emptyBoard,
  frameMembers,
  owningFrame,
  type Block,
  type Board,
  type FrameData,
} from "./types";

const note = (id: string, x: number, y: number): Block =>
  ({ id, type: "note", position: { x, y }, width: 200, height: 120, data: { title: id, body: "" } }) as Block;

const frame = (id: string, x: number, y: number, w = 600, h = 400, contains?: string[]): Block =>
  ({
    id,
    type: "frame",
    position: { x, y },
    width: w,
    height: h,
    data: { label: id, ...(contains ? { contains } : {}) } as FrameData,
  }) as Block;

const boardWith = (...nodes: Block[]): Board => ({ ...emptyBoard(), nodes });

describe("frame membership is explicit, not geometric", () => {
  it("a frame sitting on top of a block does not own it", () => {
    // The reported bug: dropping a frame over existing work made it a child, so
    // moving the frame hauled unrelated blocks across the board.
    const board = boardWith(note("orphan", 50, 50), frame("f", 0, 0));
    expect(blocksOverlappingFrame(board, "f").map((b) => b.id)).toEqual(["orphan"]);
    expect(frameMembers(board, "f")).toEqual([]);
    expect(owningFrame(board, "orphan")).toBeUndefined();
  });

  it("owns exactly what its contains list names", () => {
    const board = boardWith(note("a", 50, 50), note("b", 900, 900), frame("f", 0, 0, 600, 400, ["a", "b"]));
    expect(frameMembers(board, "f").map((n) => n.id).sort()).toEqual(["a", "b"]);
    // Even a block far outside the bounds moves with the frame once it is a member.
    expect(owningFrame(board, "b")?.id).toBe("f");
  });

  it("ignores stale ids left behind by a deleted block", () => {
    const board = boardWith(note("a", 10, 10), frame("f", 0, 0, 600, 400, ["a", "ghost"]));
    expect(frameMembers(board, "f").map((n) => n.id)).toEqual(["a"]);
  });

  it("never treats a frame as a member of another frame", () => {
    const board = boardWith(frame("inner", 20, 20, 100, 100), frame("outer", 0, 0, 600, 400));
    expect(blocksOverlappingFrame(board, "outer")).toEqual([]);
  });

  it("returns nothing for a missing or non-frame id", () => {
    const board = boardWith(note("a", 0, 0));
    expect(frameMembers(board, "nope")).toEqual([]);
    expect(frameMembers(board, "a")).toEqual([]);
    expect(blocksOverlappingFrame(board, "a")).toEqual([]);
  });
});

describe("centreInside", () => {
  const rect = { x: 0, y: 0, width: 400, height: 300 };

  it("accepts a block whose centre is inside even when it overhangs", () => {
    // 200x120 at (310,240) has its centre at (410,300) — outside.
    expect(centreInside(rect, note("out", 310, 240))).toBe(false);
    // At (250,200) the centre is (350,260) — inside, though the block overhangs.
    expect(centreInside(rect, note("in", 250, 200))).toBe(true);
  });

  it("rejects a block that merely touches the edge", () => {
    expect(centreInside(rect, note("edge", 500, 500))).toBe(false);
  });
});

describe("blockRect", () => {
  it("prefers explicit size, then measured, then the kind default", () => {
    expect(blockRect(note("a", 5, 6))).toEqual({ x: 5, y: 6, width: 200, height: 120 });

    const measured = { id: "m", type: "note", position: { x: 0, y: 0 }, measured: { width: 77, height: 88 }, data: { title: "", body: "" } } as unknown as Block;
    expect(blockRect(measured)).toEqual({ x: 0, y: 0, width: 77, height: 88 });

    const bare = { id: "b", type: "frame", position: { x: 0, y: 0 }, data: { label: "" } } as Block;
    expect(blockRect(bare)).toEqual({ x: 0, y: 0, width: 560, height: 380 });
  });
});

describe("a frame drawn around existing blocks", () => {
  // Regression: PlaceLayer created frames with an empty `contains`, so drawing a
  // frame around work adopted nothing and dragging it left everything behind —
  // contradicting FrameData's stated contract that drawing around a block joins
  // it. This asserts the predicate PlaceLayer now uses.
  it("adopts blocks whose centre falls inside it", () => {
    const box = { x: 0, y: 0, width: 400, height: 300 };
    const inside = note("inside", 100, 100);
    const outside = note("outside", 900, 900);

    const adopted = [inside, outside]
      .filter((b) => b.type !== "frame" && centreInside(box, b))
      .map((b) => b.id);

    expect(adopted).toEqual(["inside"]);
  });

  it("never adopts another frame", () => {
    const box = { x: 0, y: 0, width: 800, height: 800 };
    const inner: Block = {
      id: "inner",
      type: "frame",
      position: { x: 100, y: 100 },
      width: 200,
      height: 200,
      data: { label: "inner" } as FrameData,
    } as Block;

    const adopted = [inner].filter((b) => b.type !== "frame" && centreInside(box, b));
    expect(adopted).toEqual([]);
  });
});
