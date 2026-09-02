import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCall } from "../providers/types";

/**
 * The loop, with a scripted model.
 *
 * Everything the agent does passes through here, and until now none of it was
 * tested: the multi-tool turn, the step cap, and — added the day a local model
 * first thought for minutes — giving up on a turn. A fake provider is the only
 * way to exercise those without a key, a network, and a model willing to
 * reproduce a five-step plan on demand.
 */

const send = vi.fn();

vi.mock("../providers/registry", () => ({
  activeLLM: () => ({ id: "fake", label: "Fake", keyOptional: true, send }),
  keyFor: async () => "",
  useProviders: { getState: () => ({ settings: { llmModel: "fake-model" } }) },
}));

const runTool = vi.fn();
vi.mock("./tools", () => ({
  availableTools: () => [],
  runTool: (call: ToolCall) => runTool(call),
}));

const { runTurn } = await import("./loop");
const { useBoard, runAsAgent } = await import("../canvas/store");
const { emptyBoard } = await import("../canvas/types");

/** A model reply that asks for tools. */
const wants = (...names: string[]) => ({
  text: "",
  wantsTools: true,
  toolCalls: names.map((name, i) => ({ id: `call-${name}-${i}`, name, input: {} })),
});

/** A model reply that is done talking to tools. */
const says = (text: string) => ({ text, wantsTools: false, toolCalls: [] });

beforeEach(() => {
  send.mockReset();
  runTool.mockReset();
  runTool.mockImplementation((call: ToolCall) => ({ id: call.id, content: `did ${call.name}` }));
  useBoard.getState().load(emptyBoard());
});

describe("a turn", () => {
  it("runs every tool the model asked for, in the order it asked", async () => {
    send.mockResolvedValueOnce(wants("add_note", "connect_blocks")).mockResolvedValueOnce(says("Done."));

    const outcome = await runTurn("add two things", []);

    expect(runTool.mock.calls.map((c) => c[0].name)).toEqual(["add_note", "connect_blocks"]);
    expect(outcome.reply).toBe("Done.");
    expect(outcome.actions).toEqual(["did add_note", "did connect_blocks"]);
  });

  it("hands tool results back before asking again", async () => {
    send.mockResolvedValueOnce(wants("add_note")).mockResolvedValueOnce(says("Added it."));

    await runTurn("add a note", []);

    const second = send.mock.calls[1][0];
    const roles = second.messages.map((m: { role: string }) => m.role);
    expect(roles).toEqual(["user", "assistant", "tool"]);
    expect(second.messages[2].results[0].content).toBe("did add_note");
  });

  it("keeps a failed tool out of the reported actions", async () => {
    // The user is told what happened to the board, and nothing happened to it.
    runTool.mockImplementation((call: ToolCall) => ({
      id: call.id,
      content: "No block with id note-gone.",
      isError: true,
    }));
    send.mockResolvedValueOnce(wants("update_block")).mockResolvedValueOnce(says("I could not."));

    const outcome = await runTurn("change it", []);

    expect(outcome.actions).toEqual([]);
  });

  it("rebuilds the board into the prompt on every step, not once", async () => {
    // The claim in the file's comment, and the reason the assistant can act on
    // what it just did rather than on what was there when the turn began.
    runTool.mockImplementation((call: ToolCall) => {
      runAsAgent({
        t: "addBlock",
        block: {
          id: "note-fresh",
          type: "note",
          position: { x: 0, y: 0 },
          width: 200,
          height: 120,
          data: { title: "Fresh", body: "" },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      });
      return { id: call.id, content: "added" };
    });
    send.mockResolvedValueOnce(wants("add_note")).mockResolvedValueOnce(says("There."));

    await runTurn("add a note", []);

    expect(send.mock.calls[0][0].system).not.toContain("note-fresh");
    expect(send.mock.calls[1][0].system).toContain("note-fresh");
  });
});

describe("the step cap", () => {
  it("stops rather than looping, and says so", async () => {
    // A model that never stops asking for tools must not be able to hold the
    // turn open forever.
    send.mockResolvedValue(wants("add_note"));

    const outcome = await runTurn("go forever", []);

    expect(send).toHaveBeenCalledTimes(6);
    expect(outcome.reply).toContain("stopped before finishing");
    expect(outcome.actions).toHaveLength(6);
  });
});

describe("abandoning a turn", () => {
  it("stops between tool calls once aborted", async () => {
    const turn = new AbortController();
    runTool.mockImplementation((call: ToolCall) => {
      turn.abort();
      return { id: call.id, content: "did one" };
    });
    send.mockResolvedValue(wants("add_note", "add_note", "add_note"));

    const outcome = await runTurn("do three things", [], {}, turn.signal);

    // The first ran and aborted; the rest of the batch is not started.
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(outcome.actions).toEqual(["did one"]);
  });

  it("passes the signal to the provider, so the request itself is cancelled", async () => {
    const turn = new AbortController();
    send.mockResolvedValueOnce(says("Fine."));

    await runTurn("hello", [], {}, turn.signal);

    expect(send.mock.calls[0][0].signal).toBe(turn.signal);
  });
});
