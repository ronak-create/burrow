import { fetch } from "@tauri-apps/plugin-http";
import type { LLMProvider, LLMReply, SendOptions, ToolCall, Turn } from "../types";

/**
 * Anthropic Messages API.
 *
 * The request goes out through Tauri's HTTP client, not the webview's fetch, so
 * it carries no browser Origin — no CORS preflight, and no need for Anthropic's
 * dangerous-direct-browser-access header. This is the reason the design's "local
 * relay proxy" was dropped.
 */

const API = "https://api.anthropic.com/v1/messages";
const VERSION = "2023-06-01";

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

function toWire(messages: Turn[]) {
  return messages.map((m) => {
    if (m.role === "user") return { role: "user", content: m.text };

    if (m.role === "assistant") {
      const content: unknown[] = [];
      if (m.text) content.push({ type: "text", text: m.text });
      for (const c of m.toolCalls) {
        content.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
      }
      return { role: "assistant", content };
    }

    // Tool results are sent back as a user turn — Anthropic's convention.
    return {
      role: "user",
      content: m.results.map((r) => ({
        type: "tool_result",
        tool_use_id: r.id,
        content: r.content,
        ...(r.isError ? { is_error: true } : {}),
      })),
    };
  });
}

export const anthropic: LLMProvider = {
  id: "anthropic",
  label: "Anthropic",
  keyUrl: "https://console.anthropic.com/settings/keys",
  models: [
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ],

  async send(opts: SendOptions): Promise<LLMReply> {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": opts.apiKey,
        "anthropic-version": VERSION,
      },
      signal: opts.signal,
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 2048,
        system: opts.system,
        messages: toWire(opts.messages),
        tools: opts.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        })),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // Surface the provider's own message — it is almost always the useful part
      // (bad key, unknown model, rate limit).
      throw new Error(`Anthropic ${res.status}: ${body.slice(0, 400)}`);
    }

    const json = (await res.json()) as {
      content?: AnthropicBlock[];
      stop_reason?: string;
    };

    let text = "";
    const toolCalls: ToolCall[] = [];
    for (const block of json.content ?? []) {
      if (block.type === "text" && block.text) text += block.text;
      else if (block.type === "tool_use" && block.id && block.name) {
        toolCalls.push({ id: block.id, name: block.name, input: block.input ?? {} });
      }
    }

    return { text, toolCalls, wantsTools: json.stop_reason === "tool_use" };
  },
};
