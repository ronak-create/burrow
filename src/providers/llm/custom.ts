import { fetch } from "@tauri-apps/plugin-http";
import { openAICompatible } from "./openai";
import { useProviders } from "../registry";

/**
 * A user-configured OpenAI-compatible endpoint.
 *
 * This is the escape hatch that keeps the project honest about being local-first:
 * Ollama, LM Studio, llama.cpp's server, vLLM, LiteLLM and every hosted gateway
 * that speaks this dialect are reachable without shipping a new adapter, and none
 * of them require a key. Verified against Ollama serving gemma4:e4b, which handled
 * multi-step tool calling — including two calls in one turn — over this exact path.
 *
 * The base URL is read per request rather than captured at module load, so editing
 * it in Settings takes effect on the next turn with no restart.
 */

export const DEFAULT_CUSTOM_BASE_URL = "http://127.0.0.1:11434/v1";

export const custom = openAICompatible({
  id: "custom",
  label: "Custom / Local",
  // Accepts the base URL with or without a trailing slash, and tolerates someone
  // pasting the full completions path straight out of their server's docs.
  url: () => `${baseUrl()}/chat/completions`,
  keyUrl: "https://github.com/ollama/ollama",
  models: [],
  keyOptional: true,
  freeformModel: true,
});

/** The configured base URL, normalised — shared by the sender and the probe. */
function baseUrl(): string {
  const raw = useProviders.getState().settings.customBaseUrl || DEFAULT_CUSTOM_BASE_URL;
  return raw.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
}

/**
 * Ask the configured endpoint what it can serve.
 *
 * Local runtimes serve whatever the user happens to have pulled, so the only way
 * to offer a list instead of demanding an exact id is to ask. Every
 * OpenAI-compatible server implements /v1/models; one that does not simply yields
 * an empty list and the field stays free text.
 */
export async function listCustomModels(): Promise<string[]> {
  const res = await fetch(`${baseUrl()}/models`, { method: "GET" });
  if (!res.ok) throw new Error(`${res.status} from ${baseUrl()}/models`);
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  return (json.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id)).sort();
}
