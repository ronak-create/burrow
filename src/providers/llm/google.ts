import { fetch } from "@tauri-apps/plugin-http";
import type { LLMProvider, LLMReply, SendOptions, ToolCall, Turn } from "../types";

/**
 * Google Gemini.
 *
 * Two things differ from the other providers and are handled here rather than
 * leaking upward: Gemini identifies a tool result by the *function name* instead
 * of a call id, and it takes the key as a header rather than a bearer token.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface WirePart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
}

function toWire(messages: Turn[]) {
  const contents: Array<Record<string, unknown>> = [];

  for (const m of messages) {
    if (m.role === "user") {
      contents.push({ role: "user", parts: [{ text: m.text }] });
    } else if (m.role === "assistant") {
      const parts: WirePart[] = [];
      if (m.text) parts.push({ text: m.text });
      for (const c of m.toolCalls) parts.push({ functionCall: { name: c.name, args: c.input } });
      if (parts.length) contents.push({ role: "model", parts });
    } else {
      // Gemini matches results to calls by name, so the id we carry internally is
      // encoded into the id as "name:index" and split back out here.
      contents.push({
        role: "user",
        parts: m.results.map((r) => ({
          functionResponse: {
            name: r.id.split(":")[0],
            response: { result: r.content, ...(r.isError ? { error: true } : {}) },
          },
        })),
      });
    }
  }
  return contents;
}

export const google: LLMProvider = {
  id: "google",
  label: "Google Gemini",
  keyUrl: "https://aistudio.google.com/apikey",
  models: [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],

  async send(opts: SendOptions): Promise<LLMReply> {
    const res = await fetch(`${BASE}/${encodeURIComponent(opts.model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
      signal: opts.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: toWire(opts.messages),
        tools: [
          {
            functionDeclarations: opts.tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            })),
          },
        ],
        generationConfig: { maxOutputTokens: opts.maxTokens ?? 2048 },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gemini ${res.status}: ${body.slice(0, 400)}`);
    }

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: WirePart[] } }>;
    };

    const parts = json.candidates?.[0]?.content?.parts ?? [];
    let text = "";
    const toolCalls: ToolCall[] = [];
    parts.forEach((p, i) => {
      if (p.text) text += p.text;
      else if (p.functionCall) {
        // Name-plus-index keeps ids unique when the model calls one tool twice.
        toolCalls.push({
          id: `${p.functionCall.name}:${i}`,
          name: p.functionCall.name,
          input: p.functionCall.args ?? {},
        });
      }
    });

    return { text, toolCalls, wantsTools: toolCalls.length > 0 };
  },
};
