import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolSpec, Turn } from "../types";

/**
 * The wire format four providers share.
 *
 * OpenAI, Groq, Cerebras and every local runtime configured as "Custom" go
 * through this one adapter, so a mistake here is a mistake everywhere at once.
 * It is also the only chat adapter that has been proved against a live server
 * (Ollama, 2 Sep 2026) — these tests pin the shape that worked, so the next edit
 * cannot quietly change it.
 */

const fetchMock = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (...a: unknown[]) => fetchMock(...a) }));

const { openAICompatible } = await import("./openai");

const provider = openAICompatible({
  id: "test",
  label: "Test Provider",
  url: "https://example.invalid/v1/chat/completions",
  keyUrl: "",
  models: [{ id: "m", label: "M" }],
});

const TOOLS: ToolSpec[] = [
  {
    name: "add_note",
    description: "Add a note",
    parameters: { type: "object", properties: { title: { type: "string" } } },
  },
];

/** A chat-completions response carrying whatever the model decided. */
function reply(message: Record<string, unknown>, finish = "stop") {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message, finish_reason: finish }] }),
  };
}

const sent = () => JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);

const send = (messages: Turn[] = [{ role: "user", text: "hello" }], apiKey = "k") =>
  provider.send({ apiKey, model: "m", system: "SYSTEM", messages, tools: TOOLS });

beforeEach(() => {
  fetchMock.mockReset();
});

describe("what goes out", () => {
  it("puts the system prompt first and the turn after it", async () => {
    fetchMock.mockResolvedValueOnce(reply({ content: "hi" }));

    await send();

    expect(sent().messages).toEqual([
      { role: "system", content: "SYSTEM" },
      { role: "user", content: "hello" },
    ]);
    expect(sent().model).toBe("m");
  });

  it("declares tools in the shape the API expects", async () => {
    fetchMock.mockResolvedValueOnce(reply({ content: "hi" }));

    await send();

    expect(sent().tools).toEqual([
      {
        type: "function",
        function: {
          name: "add_note",
          description: "Add a note",
          parameters: TOOLS[0].parameters,
        },
      },
    ]);
  });

  it("sends tool results as one message each, keyed by call id", async () => {
    // The part a batch would break: the API matches results to calls by id, and
    // rejects a turn whose tool messages do not line up with the assistant's.
    fetchMock.mockResolvedValueOnce(reply({ content: "done" }));

    await send([
      { role: "user", text: "add two notes" },
      {
        role: "assistant",
        text: "",
        toolCalls: [
          { id: "call-1", name: "add_note", input: { title: "A" } },
          { id: "call-2", name: "add_note", input: { title: "B" } },
        ],
      },
      {
        role: "tool",
        results: [
          { id: "call-1", content: "Added A" },
          { id: "call-2", content: "Added B" },
        ],
      },
    ]);

    const messages = sent().messages;
    expect(messages[2].tool_calls.map((c: { id: string }) => c.id)).toEqual(["call-1", "call-2"]);
    expect(messages[2].tool_calls[0].function.arguments).toBe(JSON.stringify({ title: "A" }));
    expect(messages.slice(3)).toEqual([
      { role: "tool", tool_call_id: "call-1", content: "Added A" },
      { role: "tool", tool_call_id: "call-2", content: "Added B" },
    ]);
  });

  it("omits the authorization header when there is no key", async () => {
    // A local server usually wants none, and an empty bearer makes some of them
    // reject an otherwise fine request.
    fetchMock.mockResolvedValueOnce(reply({ content: "hi" }));

    await send([{ role: "user", text: "hello" }], "");

    const headers = (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers;
    expect(headers.authorization).toBeUndefined();
  });

  it("carries the abort signal, so a turn can be given up on", async () => {
    fetchMock.mockResolvedValueOnce(reply({ content: "hi" }));
    const turn = new AbortController();

    await provider.send({
      apiKey: "k",
      model: "m",
      system: "S",
      messages: [{ role: "user", text: "hi" }],
      tools: [],
      signal: turn.signal,
    });

    expect((fetchMock.mock.calls[0][1] as { signal?: AbortSignal }).signal).toBe(turn.signal);
  });
});

describe("what comes back", () => {
  it("reads several tool calls out of one reply, in order", async () => {
    fetchMock.mockResolvedValueOnce(
      reply(
        {
          content: null,
          tool_calls: [
            { id: "a", type: "function", function: { name: "add_note", arguments: '{"title":"A"}' } },
            { id: "b", type: "function", function: { name: "connect_blocks", arguments: '{"from":"1"}' } },
          ],
        },
        "tool_calls",
      ),
    );

    const out = await send();

    expect(out.wantsTools).toBe(true);
    expect(out.toolCalls).toEqual([
      { id: "a", name: "add_note", input: { title: "A" } },
      { id: "b", name: "connect_blocks", input: { from: "1" } },
    ]);
  });

  it("survives arguments that are not valid JSON", async () => {
    // Observed in the wild from smaller models. An empty object lets the tool
    // report a useful error; throwing here would lose the whole turn.
    fetchMock.mockResolvedValueOnce(
      reply(
        {
          content: null,
          tool_calls: [{ id: "a", type: "function", function: { name: "add_note", arguments: "{oops" } }],
        },
        "tool_calls",
      ),
    );

    const out = await send();

    expect(out.toolCalls[0].input).toEqual({});
    expect(out.toolCalls[0].name).toBe("add_note");
  });

  it("treats tool calls as wanted even when finish_reason does not say so", async () => {
    // Not every compatible server sets finish_reason correctly; the calls
    // themselves are the fact.
    fetchMock.mockResolvedValueOnce(
      reply(
        {
          content: "",
          tool_calls: [{ id: "a", type: "function", function: { name: "add_note", arguments: "{}" } }],
        },
        "stop",
      ),
    );

    expect((await send()).wantsTools).toBe(true);
  });

  it("returns plain text with no tools wanted", async () => {
    fetchMock.mockResolvedValueOnce(reply({ content: "Just talking." }));

    const out = await send();

    expect(out).toMatchObject({ text: "Just talking.", wantsTools: false, toolCalls: [] });
  });

  it("names the provider in the error, since four of them share this code", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => "rate limited",
    });

    await expect(send()).rejects.toThrow(/Test Provider 429/);
  });
});
