import { fetch } from "@tauri-apps/plugin-http";
import type { LLMProvider, LLMReply, SendOptions, ToolCall, Turn } from "../types";

/**
 * OpenAI Chat Completions.
 *
 * Also the shape used by most OpenAI-compatible gateways, so this adapter is the
 * cheapest path to supporting others later.
 */

const API = "https://api.openai.com/v1/chat/completions";

interface WireToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

function toWire(system: string, messages: Turn[]) {
  const out: Array<Record<string, unknown>> = [{ role: "system", content: system }];

  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.text });
    } else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.text || null,
        ...(m.toolCalls.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: "function",
                function: { name: c.name, arguments: JSON.stringify(c.input) },
              })),
            }
          : {}),
      });
    } else {
      // OpenAI wants one message per tool result, not a batch.
      for (const r of m.results) {
        out.push({ role: "tool", tool_call_id: r.id, content: r.content });
      }
    }
  }
  return out;
}

export const openai: LLMProvider = {
  id: "openai",
  label: "OpenAI",
  keyUrl: "https://platform.openai.com/api-keys",
  models: [
    { id: "gpt-5", label: "GPT-5" },
    { id: "gpt-5-mini", label: "GPT-5 mini" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "o4-mini", label: "o4-mini" },
  ],

  async send(opts: SendOptions): Promise<LLMReply> {
    const res = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opts.apiKey}` },
      signal: opts.signal,
      body: JSON.stringify({
        model: opts.model,
        max_completion_tokens: opts.maxTokens ?? 2048,
        messages: toWire(opts.system, opts.messages),
        tools: opts.tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        })),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status}: ${body.slice(0, 400)}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{
        message?: { content?: string | null; tool_calls?: WireToolCall[] };
        finish_reason?: string;
      }>;
    };

    const choice = json.choices?.[0];
    const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? []).map((c) => {
      let input: Record<string, unknown> = {};
      try {
        // Arguments arrive as a JSON string and are occasionally malformed;
        // an empty object lets the tool report a useful error instead of crashing.
        input = c.function.arguments ? JSON.parse(c.function.arguments) : {};
      } catch {
        input = {};
      }
      return { id: c.id, name: c.function.name, input };
    });

    return {
      text: choice?.message?.content ?? "",
      toolCalls,
      wantsTools: choice?.finish_reason === "tool_calls" || toolCalls.length > 0,
    };
  },
};
