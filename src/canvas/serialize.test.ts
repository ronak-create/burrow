import { describe, expect, it } from "vitest";
import { boardView } from "./serialize";
import { emptyBoard, type Block, type Board } from "./types";

const note = (id: string, x: number, y: number, extra: Partial<Block> = {}): Block =>
  ({
    id,
    type: "note",
    position: { x, y },
    width: 200,
    height: 120,
    data: { title: id, body: "" },
    ...extra,
  }) as Block;

const boardWith = (nodes: Block[], viewport = { x: 0, y: 0, zoom: 1 }): Board => ({
  ...emptyBoard(),
  nodes,
  viewport,
});

const byId = (view: ReturnType<typeof boardView>, id: string) =>
  view.blocks.find((b) => b.id === id)!;

describe("what the user is looking at", () => {
  it("reports the selection, which is what 'this one' means", () => {
    const view = boardView(boardWith([note("a", 0, 0, { selected: true }), note("b", 400, 0)]));

    expect(view.selection).toEqual(["a"]);
    expect(byId(view, "a").selected).toBe(true);
    // Omitted rather than false: most blocks on most boards are not selected, and
    // this JSON is sent on every step of every turn.
    expect(byId(view, "b")).not.toHaveProperty("selected");
  });

  it("marks what is off screen, so the assistant does not claim it is visible", () => {
    const board = boardWith([note("near", 0, 0), note("far", 5000, 5000)]);
    const view = boardView(board, { width: 1000, height: 800 });

    expect(view.visible).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
    expect(byId(view, "near")).not.toHaveProperty("offScreen");
    expect(byId(view, "far").offScreen).toBe(true);
  });

  it("accounts for pan and zoom", () => {
    // Panned right and down by 200 at 2x: the user sees a smaller region of the
    // board, starting at -100 in board coordinates.
    const board = boardWith([note("a", 0, 0)], { x: 200, y: 200, zoom: 2 });
    const view = boardView(board, { width: 1000, height: 800 });

    expect(view.visible).toEqual({ x: -100, y: -100, width: 500, height: 400 });
  });

  it("says nothing about visibility when the canvas is not mounted", () => {
    const view = boardView(boardWith([note("a", 0, 0)]));

    expect(view.visible).toBeNull();
    // The honest answer is silence, not a guess that everything is on screen.
    expect(view.blocks.every((b) => !("offScreen" in b))).toBe(true);
  });

  it("a block straddling the edge counts as visible", () => {
    const board = boardWith([note("edge", 950, 0)]);
    const view = boardView(board, { width: 1000, height: 800 });

    expect(byId(view, "edge")).not.toHaveProperty("offScreen");
  });
});
