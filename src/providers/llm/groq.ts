import { openAICompatible } from "./openai";

/**
 * Groq.
 *
 * Chat completions here are OpenAI-shaped, so this is configuration over the
 * shared adapter rather than a second implementation. The id is deliberately the
 * same "groq" used by the Whisper provider: one account, one key, one entry in the
 * OS keychain — configuring speech also configures the model, and vice versa.
 *
 * Model list is the tool-capable subset. Groq also serves small guard and audio
 * models on the same endpoint; those cannot drive the agent loop, so they are not
 * offered here.
 */
export const groq = openAICompatible({
  id: "groq",
  label: "Groq",
  url: "https://api.groq.com/openai/v1/chat/completions",
  keyUrl: "https://console.groq.com/keys",
  models: [
    { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
    { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B" },
    { id: "qwen/qwen3.8-27b", label: "Qwen3.8 27B" },
    { id: "qwen/qwen3.6-27b", label: "Qwen3.6 27B" },
  ],
});
