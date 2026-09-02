import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCall } from "../providers/types";

/**
 * The tools, against a real board.
 *
 * The store is deliberately not mocked. Every tool resolves to the same Command
 * union the toolbar uses, and the whole point of that design is that agent edits
 * and user edits land on one undo stack — a test that stubbed the store would
 * check the shape of a call and prove nothing about the thing being claimed.
 *
 * Everything that leaves the machine is mocked, because none of it is the
 * subject here.
 */

vi.mock("../workspace/current", () => ({
  useCurrentWorkspace: { getState: () => ({ root: "/ws", id: "w1" }) },
}));
vi.mock("../workspace/api", () => ({
  listDocuments: async () => [],
  readDocumentText: async () => "",
  writeImage: async () => ({ file: "img.png" }),
}));
vi.mock("./research", () => ({
  SOURCES: [],
  formatPaper: () => "",
  searchPapers: async () => [],
}));
vi.mock("../providers/vision", () => ({
  describeImage: async () => "",
  looksLikeNoImage: () => false,
  providerCanCarryImages: () => true,
}));
vi.mock("../providers/search", () => ({ formatResult: () => "" }));
vi.mock("../canvas/ink/render", () => ({ renderInk: async () => "" }));
vi.mock("../providers/registry", () => ({
  activeImage: () => ({ id: "img", label: "Img" }),
  activeLLM: () => ({ id: "fake", label: "Fake", keyOptional: true }),
  activeSearch: () => ({ id: "web", label: "Web" }),
  canChat: () => true,
  canGenerateImages: () => false,
  canSearchWeb: () => false,
  keyFor: async () => "",
  useProviders: { getState: () => ({ settings: {} }) },
}));

const { runTool } = await import("./tools");
const { useBoard, runAsUser } = await import("../canvas/store");
const { emptyBoard } = await import("../canvas/types");

const call = (name: string, input: Record<string, unknown> = {}): ToolCall => ({
  id: "c-" + name,
  name,
  input,
});

const board = () => useBoard.getState().board;
const ids = () => board().nodes.map((n) => n.id);
const history = () => useBoard.getState().past;

/** Put a note on the board the way the user would, and return its id. */
function userNote(id: string, x = 0, y = 0) {
  runAsUser({
    t: "addBlock",
    block: {
      id,
      type: "note",
      position: { x, y },
      width: 200,
      height: 120,
      data: { title: id, body: "" },
    } as never,
  });
  return id;
}

beforeEach(() => {
  useBoard.getState().load(emptyBoard());
});

describe("writing to the board", () => {
  it("adds a note and reports the id it chose", async () => {
    const result = await runTool(call("add_note", { title: "Redis", body: "in-memory store" }));

    expect(result.isError).toBeUndefined();
    expect(board().nodes).toHaveLength(1);
    const added = board().nodes[0];
    expect(added.data).toMatchObject({ title: "Redis", body: "in-memory store" });
    // The id has to be in the reply: it is how the next turn refers to this block.
    expect(result.content).toContain(added.id);
  });

  it("puts it where it was told, when it was told", async () => {
    await runTool(call("add_note", { title: "There", x: 640, y: -120 }));

    expect(board().nodes[0].position).toEqual({ x: 640, y: -120 });
  });

  it("finds its own spot when it was not", async () => {
    userNote("note-a", 0, 0);

    await runTool(call("add_note", { title: "Somewhere" }));

    const placed = board().nodes.find((n) => n.id !== "note-a");
    // Not on top of the existing one, which is the entire job of placement.
    expect(placed?.position).not.toEqual({ x: 0, y: 0 });
  });

  it("connects two blocks", async () => {
    userNote("note-a");
    userNote("note-b", 400);

    const result = await runTool(
      call("connect_blocks", { from: "note-a", to: "note-b", label: "causes" }),
    );

    expect(result.isError).toBeUndefined();
    expect(board().edges).toHaveLength(1);
    expect(board().edges[0]).toMatchObject({
      source: "note-a",
      target: "note-b",
      label: "causes",
    });
  });
});

describe("refusing", () => {
  it("will not act on a block that is not there, and says which", async () => {
    for (const name of ["update_block", "move_block", "delete_block", "flag_block"]) {
      const result = await runTool(call(name, { id: "note-gone", title: "x", x: 0, y: 0 }));

      expect(result.isError, name).toBe(true);
      expect(result.content, name).toContain("note-gone");
    }
    expect(history()).toHaveLength(0);
  });

  it("will not connect a block to itself", async () => {
    userNote("note-a");

    const result = await runTool(call("connect_blocks", { from: "note-a", to: "note-a" }));

    expect(result.isError).toBe(true);
    expect(board().edges).toHaveLength(0);
  });

  it("will not update a block with nothing to update", async () => {
    userNote("note-a");

    const result = await runTool(call("update_block", { id: "note-a" }));

    expect(result.isError).toBe(true);
  });

  it("asks before framing work that already exists", async () => {
    // Spec C: free rein on a sparse board, consent on a populated one.
    for (const id of ["a", "b", "c", "d"]) userNote("note-" + id, 0, 0);

    const refused = await runTool(call("add_frame", { label: "Themes" }));
    expect(refused.isError).toBe(true);
    expect(refused.content).toMatch(/agreement|ask/i);
    expect(board().nodes.filter((n) => n.type === "frame")).toHaveLength(0);

    const allowed = await runTool(call("add_frame", { label: "Themes", userApproved: true }));
    expect(allowed.isError).toBeUndefined();
    expect(board().nodes.filter((n) => n.type === "frame")).toHaveLength(1);
  });
});

/**
 * Both hands on the same board.
 *
 * The assistant plans against the board as it was when the step began, and the
 * user is not asked to sit still while it thinks. So a plan can name a block that
 * has since been deleted — which must fail in a way the model can explain, not in
 * a way that corrupts the board or the undo stack.
 */
describe("the user editing underneath the assistant", () => {
  it("fails cleanly on a block the user deleted mid-turn", async () => {
    userNote("note-doomed");
    // The model has already decided to update note-doomed. Before the call lands,
    // the user removes it.
    runAsUser({ t: "removeBlock", id: "note-doomed" });

    const result = await runTool(call("update_block", { id: "note-doomed", title: "New" }));

    expect(result.isError).toBe(true);
    // Named, so the model can say what happened instead of retrying blindly.
    expect(result.content).toContain("note-doomed");
    expect(ids()).toEqual([]);
  });

  it("does not put a failed agent edit on the undo stack", async () => {
    userNote("note-doomed");
    runAsUser({ t: "removeBlock", id: "note-doomed" });
    const before = history().length;

    await runTool(call("move_block", { id: "note-doomed", x: 10, y: 10 }));

    // Ctrl+Z must undo the user's delete, not a no-op nobody performed.
    expect(history()).toHaveLength(before);
    expect(history()[before - 1].origin).toBe("user");
  });

  it("keeps both hands on one undo stack, in order", async () => {
    userNote("note-a");
    await runTool(call("add_note", { title: "From the assistant" }));
    runAsUser({ t: "updateBlock", id: "note-a", patch: { title: "Renamed by hand" } });

    expect(history().map((e) => e.origin)).toEqual(["user", "agent", "user"]);

    // And it unwinds in that order, regardless of whose edit it was.
    useBoard.getState().undo();
    expect(board().nodes.find((n) => n.id === "note-a")?.data).toMatchObject({ title: "note-a" });
    useBoard.getState().undo();
    expect(board().nodes).toHaveLength(1);
  });

  it("survives a deletion between two of the assistant's own calls", async () => {
    userNote("note-a");
    const added = await runTool(call("add_note", { title: "Second" }));
    const newId = board().nodes.find((n) => n.id !== "note-a")?.id as string;
    expect(added.content).toContain(newId);

    runAsUser({ t: "removeBlock", id: "note-a" });

    const result = await runTool(call("connect_blocks", { from: newId, to: "note-a" }));

    expect(result.isError).toBe(true);
    expect(board().edges).toHaveLength(0);
    // The assistant's own block is untouched by the failure.
    expect(ids()).toEqual([newId]);
  });
});
