import { fetch } from "@tauri-apps/plugin-http";
import type { LLMProvider, LLMReply, SendOptions, ToolCall, Turn } from "../types";

/**
 * OpenAI Chat Completions, and every gateway that speaks the same dialect.
 *
 * This wire format is shared by a long tail of providers, so the adapter is a
 * factory over {url, models} rather than one hardcoded provider. Groq is the first
 * caller; adding another compatible gateway is a config object, not a new file.
 */

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

export interface OpenAICompatibleConfig {
  id: string;
  label: string;
  /**
   * Full chat-completions URL. A function is resolved per request, which is what
   * lets a user-configured endpoint change without rebuilding the provider.
   */
  url: string | (() => string);
  keyUrl: string;
  models: Array<{ id: string; label: string }>;
  keyOptional?: boolean;
  freeformModel?: boolean;
}

export function openAICompatible(cfg: OpenAICompatibleConfig): LLMProvider {
  return {
    id: cfg.id,
    label: cfg.label,
    keyUrl: cfg.keyUrl,
    models: cfg.models,
    keyOptional: cfg.keyOptional,
    freeformModel: cfg.freeformModel,

    async send(opts: SendOptions): Promise<LLMReply> {
      const url = typeof cfg.url === "function" ? cfg.url() : cfg.url;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // A local server usually wants no auth at all; sending an empty bearer
          // makes some of them reject an otherwise fine request.
          ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
        },
        signal: opts.signal,
        body: JSON.stringify({
          model: opts.model,
          max_completion_tokens: opts.maxTokens ?? 8192,
          messages: toWire(opts.system, opts.messages),
          tools: opts.tools.map((t) => ({
            type: "function",
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        // Name the provider that actually failed — several share this adapter.
        throw new Error(`${cfg.label} ${res.status}: ${body.slice(0, 400)}`);
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
}

export const openai = openAICompatible({
  id: "openai",
  label: "OpenAI",
  url: "https://api.openai.com/v1/chat/completions",
  keyUrl: "https://platform.openai.com/api-keys",
  models: [
    { id: "gpt-5", label: "GPT-5" },
    { id: "gpt-5-mini", label: "GPT-5 mini" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "o4-mini", label: "o4-mini" },
  ],
});
