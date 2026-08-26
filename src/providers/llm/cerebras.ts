import { openAICompatible } from "./openai";

/**
 * Cerebras.
 *
 * OpenAI-shaped, so it is configuration over the shared adapter. Note that a valid
 * key is not sufficient: chat completions are quota-gated and return 402 until the
 * account has billing enabled, even though /v1/models lists fine. The adapter
 * surfaces the provider's own message, so that case reads as
 * "Cerebras 402: Payment required to access this resource".
 */
export const cerebras = openAICompatible({
  id: "cerebras",
  label: "Cerebras",
  url: "https://api.cerebras.ai/v1/chat/completions",
  keyUrl: "https://cloud.cerebras.ai/platform/apikeys",
  models: [
    { id: "gpt-oss-120b", label: "GPT-OSS 120B" },
    { id: "gemma-4-31b", label: "Gemma 4 31B" },
  ],
});
