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
  /**
   * True when the provider can run without a key at all — a local server on
   * loopback, typically. Such a provider is ready as soon as it is pointed at an
   * endpoint, so the "is chat available" check must not look for a key.
   */
  keyOptional?: boolean;
  /**
   * True when the model is typed rather than chosen. Local runtimes serve whatever
   * the user has pulled, so there is no list to enumerate.
   */
  freeformModel?: boolean;
  send(opts: SendOptions): Promise<LLMReply>;
}

export interface STTProvider {
  id: string;
  label: string;
  keyUrl: string;
  /**
   * True when the provider can run without a key — a Whisper server on loopback.
   * The capability check must then look at the endpoint rather than the keychain,
   * which would always report such a provider as unconfigured.
   */
  keyOptional?: boolean;
  /**
   * True when the endpoint and model are typed rather than fixed. A local server
   * runs whatever the user has on disk, so there is no list to enumerate.
   */
  freeformModel?: boolean;
  /** Returns the transcript for a recorded audio blob. */
  transcribe(opts: { apiKey: string; audio: Blob; mimeType: string }): Promise<string>;
}
