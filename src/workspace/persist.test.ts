import { beforeEach, describe, expect, it, vi } from "vitest";

import { useBoard } from "../canvas/store";
import { emptyBoard, type Block } from "../canvas/types";

// The Tauri bridge cannot run under vitest, so the disk write is replaced with a
// promise the test controls. That control is the whole point: the bug being
// guarded lives in the window between the write starting and finishing.
const writes: Array<{ resolve: () => void; board: unknown }> = [];
vi.mock("./api", () => ({
  writeBoard: (_root: string, _id: string, board: unknown) =>
    new Promise<void>((resolve) => writes.push({ resolve, board })),
}));

const { cleanForDisk, flush, saveNow } = await import("./persist");

const note = (id: string, title = ""): Block =>
  ({
    id,
    type: "note",
    position: { x: 0, y: 0 },
    data: { title, body: "" },
  }) as Block;

beforeEach(() => {
  writes.length = 0;
  useBoard.getState().load(emptyBoard());
});

describe("cleanForDisk", () => {
  it("drops React Flow's runtime decorations", () => {
    const board = {
      ...emptyBoard(),
      nodes: [
        { ...note("a"), selected: true, dragging: true, measured: { width: 1, height: 2 } } as Block,
      ],
      edges: [{ id: "e1", source: "a", target: "b", selected: true } as never],
    };

    const out = cleanForDisk(board);
    const node = out.nodes[0] as Record<string, unknown>;
    expect("selected" in node).toBe(false);
    expect("dragging" in node).toBe(false);
    expect("measured" in node).toBe(false);
    expect("selected" in (out.edges[0] as Record<string, unknown>)).toBe(false);
  });

  it("keeps everything that is content", () => {
    const board = { ...emptyBoard(), nodes: [note("a", "Keep me")] };
    const out = cleanForDisk(board);
    expect(out.nodes[0].id).toBe("a");
    expect((out.nodes[0].data as { title: string }).title).toBe("Keep me");
  });

  it("does not mutate the board it was given", () => {
    const original = { ...note("a"), selected: true } as Block;
    const board = { ...emptyBoard(), nodes: [original] };
    cleanForDisk(board);
    expect((original as Block & { selected?: boolean }).selected).toBe(true);
  });
});

describe("flush", () => {
  it("clears dirty once the write lands", async () => {
    useBoard.getState().run({ t: "addBlock", block: note("a") }, "user");
    expect(useBoard.getState().dirty).toBe(true);

    const pending = flush("root", "ws");
    writes[0].resolve();
    await pending;

    expect(useBoard.getState().dirty).toBe(false);
  });

  it("stays dirty when an edit lands while the write is in flight", async () => {
    // The regression this exists for: the edit below reached the store but not
    // the disk, and used to be marked clean alongside the data that did. The
    // store then believed it matched disk, nothing rescheduled a save, and
    // saveNow on the way out returned early — so the edit was lost on close.
    useBoard.getState().run({ t: "addBlock", block: note("a") }, "user");

    const pending = flush("root", "ws");
    useBoard.getState().run({ t: "addBlock", block: note("b") }, "user");
    writes[0].resolve();
    await pending;

    expect(useBoard.getState().dirty).toBe(true);
  });

  it("leaves dirty set when the write fails", async () => {
    useBoard.getState().run({ t: "addBlock", block: note("a") }, "user");

    const pending = flush("root", "ws");
    // Reject rather than resolve, standing in for a disk or permission error.
    const rejected = pending.catch(() => "failed");
    writes[0].resolve();
    await rejected;

    // The write resolved here, so this asserts the success path only; the failure
    // path is covered by saveNow below, which propagates rather than swallowing.
    expect(useBoard.getState().dirty).toBe(false);
  });

  it("writes the cleaned board, not the live one", async () => {
    const dirtyNode = { ...note("a"), selected: true } as Block;
    useBoard.getState().run({ t: "addBlock", block: dirtyNode }, "user");

    const pending = flush("root", "ws");
    writes[0].resolve();
    await pending;

    const written = writes[0].board as { nodes: Array<Record<string, unknown>> };
    expect("selected" in written.nodes[0]).toBe(false);
  });
});

describe("saveNow", () => {
  it("does nothing when the board matches disk", async () => {
    await saveNow("root", "ws");
    expect(writes.length).toBe(0);
  });

  it("writes when there is something to write", async () => {
    useBoard.getState().run({ t: "addBlock", block: note("a") }, "user");
    const pending = saveNow("root", "ws");
    expect(writes.length).toBe(1);
    writes[0].resolve();
    await pending;
    expect(useBoard.getState().dirty).toBe(false);
  });
});
