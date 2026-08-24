/**
 * Provider-neutral chat types.
 *
 * Model selection is a core feature of this product (spec E), so nothing above
 * this layer may reference a specific vendor's wire format. Each provider maps
 * these shapes onto its own API and back.
 */

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool's arguments. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  content: string;
  isError?: boolean;
}

export type Turn =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: ToolCall[] }
  | { role: "tool"; results: ToolResult[] };

export interface LLMReply {
  text: string;
  toolCalls: ToolCall[];
  /** True when the model stopped because it wants tool results back. */
  wantsTools: boolean;
}

export interface SendOptions {
  apiKey: string;
  model: string;
  system: string;
  messages: Turn[];
  tools: ToolSpec[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LLMProvider {
  id: string;
  label: string;
  models: Array<{ id: string; label: string }>;
  /** Where the user gets a key, shown in settings. */
  keyUrl: string;
  send(opts: SendOptions): Promise<LLMReply>;
}

export interface STTProvider {
  id: string;
  label: string;
  keyUrl: string;
  /** Returns the transcript for a recorded audio blob. */
  transcribe(opts: { apiKey: string; audio: Blob; mimeType: string }): Promise<string>;
}
