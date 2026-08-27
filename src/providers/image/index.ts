import { fetch } from "@tauri-apps/plugin-http";
import { useProviders } from "../registry";

/**
 * Image generation (spec H).
 *
 * Provider-agnostic by the same rule as the reasoning layer: the user picks who
 * draws, using their own key, and nothing above this file knows which one they
 * chose — including a custom endpoint, so a local image server is as much a first
 * class option here as a local model is for chat.
 *
 * Every provider returns raw base64 rather than a URL. A hosted URL expires, and
 * this app's storage posture is that a workspace folder is self-contained and
 * still opens a year later with no network.
 */

export interface ImageRequest {
  apiKey: string;
  model: string;
  prompt: string;
  signal?: AbortSignal;
}

export interface GeneratedImage {
  /** Raw base64, no data: prefix. */
  base64: string;
  /** File extension without the dot. */
  ext: string;
}

export interface ImageProvider {
  id: string;
  label: string;
  keyUrl: string;
  models: Array<{ id: string; label: string }>;
  /** True when the provider needs no key — a local server, typically. */
  keyOptional?: boolean;
  /** True when the model is typed rather than picked from a list. */
  freeformModel?: boolean;
  generate(req: ImageRequest): Promise<GeneratedImage>;
}

/** Providers answer with wildly different error shapes; surface something readable. */
async function failure(label: string, res: Response): Promise<never> {
  const body = await res.text().catch(() => "");
  throw new Error(`${label} ${res.status}: ${body.slice(0, 400)}`);
}

/* ---------------- OpenAI images dialect ---------------- */

interface OpenAIImageConfig {
  id: string;
  label: string;
  /** Full generations URL. A function is resolved per request, for user-set endpoints. */
  url: string | (() => string);
  keyUrl: string;
  models: Array<{ id: string; label: string }>;
  keyOptional?: boolean;
  freeformModel?: boolean;
}

/**
 * The `/v1/images/generations` shape, which OpenAI defined and LocalAI, LiteLLM,
 * OpenRouter and most self-hosted gateways copied. One factory covers all of them,
 * so adding a compatible provider is a config object rather than a new adapter.
 */
function openAIImageCompatible(cfg: OpenAIImageConfig): ImageProvider {
  return {
    id: cfg.id,
    label: cfg.label,
    keyUrl: cfg.keyUrl,
    models: cfg.models,
    keyOptional: cfg.keyOptional,
    freeformModel: cfg.freeformModel,

    async generate({ apiKey, model, prompt, signal }) {
      const url = typeof cfg.url === "function" ? cfg.url() : cfg.url;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // A local server usually wants no auth; an empty bearer makes some of
          // them reject an otherwise fine request.
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        signal,
        body: JSON.stringify({
          model,
          prompt,
          n: 1,
          // gpt-image-1 always returns base64 and rejects this parameter. Everything
          // else defaults to a URL that expires, so it must be asked for explicitly.
          ...(model === "gpt-image-1" ? {} : { response_format: "b64_json" }),
        }),
      });
      if (!res.ok) await failure(cfg.label, res);

      const json = (await res.json()) as {
        data?: Array<{ b64_json?: string; url?: string }>;
      };
      const first = json.data?.[0];
      if (!first?.b64_json) {
        // A gateway that ignored response_format hands back a URL. Say which
        // problem this is, rather than "no image".
        if (first?.url) {
          throw new Error(
            `${cfg.label} returned a link instead of image data, which this app cannot store offline.`,
          );
        }
        throw new Error(`${cfg.label} returned no image data.`);
      }
      return { base64: first.b64_json, ext: "png" };
    },
  };
}

const openaiImages = openAIImageCompatible({
  id: "openai-image",
  label: "OpenAI Images",
  url: "https://api.openai.com/v1/images/generations",
  keyUrl: "https://platform.openai.com/api-keys",
  models: [
    { id: "gpt-image-1", label: "GPT Image 1" },
    { id: "dall-e-3", label: "DALL·E 3" },
  ],
});

export const DEFAULT_IMAGE_BASE_URL = "http://127.0.0.1:8080/v1";

/**
 * A user-configured OpenAI-compatible image endpoint — the same escape hatch the
 * reasoning layer has. Covers LocalAI, LiteLLM, OpenRouter, an Automatic1111 or
 * ComfyUI front-end that speaks this dialect, or any hosted provider not listed
 * here. Read per request, so editing it in Settings takes effect immediately.
 */
const customImages = openAIImageCompatible({
  id: "custom-image",
  label: "Custom / Local",
  url: () => `${imageBaseUrl()}/images/generations`,
  keyUrl: "https://github.com/mudler/LocalAI",
  models: [],
  keyOptional: true,
  freeformModel: true,
});

function imageBaseUrl(): string {
  const raw = useProviders.getState().settings.imageBaseUrl || DEFAULT_IMAGE_BASE_URL;
  // Tolerates a trailing slash, and someone pasting the full generations path
  // straight out of their server's docs.
  return raw.trim().replace(/\/+$/, "").replace(/\/images\/generations$/, "");
}

/* ---------------- Google ---------------- */

const googleImages: ImageProvider = {
  id: "google-image",
  label: "Google Imagen",
  keyUrl: "https://aistudio.google.com/apikey",
  models: [
    { id: "imagen-4.0-generate-001", label: "Imagen 4" },
    { id: "imagen-3.0-generate-002", label: "Imagen 3" },
  ],

  async generate({ apiKey, model, prompt, signal }) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`,
      {
        method: "POST",
        // The key goes in a header, not the query string: a URL is the thing most
        // likely to end up in a log or an error message.
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        signal,
        body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1 } }),
      },
    );
    if (!res.ok) await failure("Google Imagen", res);

    const json = (await res.json()) as {
      predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
    };
    const p = json.predictions?.[0];
    if (!p?.bytesBase64Encoded) throw new Error("Google Imagen returned no image data.");
    return {
      base64: p.bytesBase64Encoded,
      ext: p.mimeType === "image/jpeg" ? "jpg" : "png",
    };
  },
};

export const IMAGE_PROVIDERS: ImageProvider[] = [openaiImages, googleImages, customImages];

/** Ask a custom endpoint what it can serve, for the model dropdown. */
export async function listCustomImageModels(): Promise<string[]> {
  const res = await fetch(`${imageBaseUrl()}/models`, { method: "GET" });
  if (!res.ok) throw new Error(`${res.status} from ${imageBaseUrl()}/models`);
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  return (json.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id)).sort();
}
