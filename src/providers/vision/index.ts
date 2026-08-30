import { fetch } from "@tauri-apps/plugin-http";
import { useProviders } from "../registry";

/**
 * Showing one image to the configured reasoning model (spec F).
 *
 * Deliberately a side call rather than a change to `Turn`.
 *
 * The alternative was making the conversation itself multimodal: images in the
 * message history, every adapter taught to carry them, the agent loop taught to
 * trim them. That is a large change to the one part of the system every feature
 * depends on, in order to serve a fallback that spec F scopes to hand-drawn ink
 * alone. It would also put the picture in the history, where it would be re-sent
 * on every subsequent turn — the same mistake the image-generation tool
 * deliberately avoided by writing files instead of inlining base64 into the board.
 *
 * So a sketch is described once, and what enters the conversation is the
 * description: a sentence or two of text, which costs nothing to carry and is
 * what the model would have reasoned over anyway.
 */

export interface VisionRequest {
  apiKey: string;
  model: string;
  base64: string;
  prompt: string;
  signal?: AbortSignal;
}

async function failure(label: string, res: Response): Promise<never> {
  const body = await res.text().catch(() => "");
  throw new Error(`${label} ${res.status}: ${body.slice(0, 400)}`);
}

const MAX_TOKENS = 1024;

/* ---------------- Anthropic ---------------- */

async function anthropicVision(req: VisionRequest): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": req.apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal: req.signal,
    body: JSON.stringify({
      model: req.model,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: req.base64 },
            },
            { type: "text", text: req.prompt },
          ],
        },
      ],
    }),
  });
  if (!res.ok) await failure("Anthropic", res);

  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return (json.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
}

/* ---------------- OpenAI dialect ---------------- */

/**
 * Covers OpenAI, Groq, Cerebras and any user-configured gateway. The image rides
 * as a `data:` URL rather than a hosted one, for the same reason generated images
 * are stored as files: nothing here should depend on a URL that expires, and a
 * local server has no internet to fetch one with anyway.
 */
async function openAIVision(url: string, label: string, req: VisionRequest): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(req.apiKey ? { authorization: `Bearer ${req.apiKey}` } : {}),
    },
    signal: req.signal,
    body: JSON.stringify({
      model: req.model,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: req.prompt },
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${req.base64}` },
            },
          ],
        },
      ],
    }),
  });
  if (!res.ok) await failure(label, res);

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return (json.choices?.[0]?.message?.content ?? "").trim();
}

/* ---------------- Google ---------------- */

async function googleVision(req: VisionRequest): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      req.model,
    )}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": req.apiKey },
      signal: req.signal,
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { inline_data: { mime_type: "image/png", data: req.base64 } },
              { text: req.prompt },
            ],
          },
        ],
      }),
    },
  );
  if (!res.ok) await failure("Google", res);

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return (json.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();
}

/** Base URL for the user-configured endpoint, normalised the same way chat does. */
function customBaseUrl(): string {
  const raw = useProviders.getState().settings.customBaseUrl || "http://127.0.0.1:11434/v1";
  return raw.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
}

/* ---------------- when the image does not arrive ---------------- */

/**
 * Did the model answer as though no picture arrived?
 *
 * Not a theoretical safeguard. Tested 30 Aug 2026 against a local model that
 * Ollama itself reports as vision-capable: it could not read large text in the
 * picture, denied a red arrow filling a third of the frame, and asked to be sent
 * an image — on both the OpenAI-compatible route and Ollama's own. Whether the
 * cause is the model, the packaging or the server was not established, and the
 * honest answer is that a "vision" flag from a local runtime cannot be trusted.
 *
 * What matters is the shape of the failure. The model does not error; it answers
 * fluently, as though asked a question with no picture attached. Passed through
 * unchecked, the assistant receives a confident account of a drawing nobody
 * showed it — the failure this project spends the most effort avoiding.
 *
 * Deliberately narrow: it matches a model *asking for* an image, not one
 * describing a blank one. Turning a real description into an error is the worse
 * mistake of the two.
 */

export function looksLikeNoImage(text: string): boolean {
  const t = text.toLowerCase();

  // Says outright that none arrived: "no image was provided", "I don't see any
  // image here". Both halves are required, so "there is no arrow in the picture"
  // - a real description - does not match.
  const denies =
    /\b(no|any|an?) (image|picture|photo|attachment)\b/.test(t) &&
    /\b(provided|attached|uploaded|shared|see|received?|available|here)\b/.test(t);

  // Asks to be sent one. The commoner form in practice, and the one the first
  // version of this guard missed: a model saying "I need the image of the
  // research board" never denies having one, it just requests it.
  const asks =
    /\b(provide|upload|share|attach|send|give)\b[^.!?]{0,40}\b(image|picture|photo)\b/.test(t) ||
    /\bi (need|require|would need)\b[^.!?]{0,40}\b(image|picture|photo)\b/.test(t);

  return denies || asks;
}

/**
 * Every provider here can carry an image. Whether the *model* can is a different
 * question, and not one this code can answer — vision support varies model by
 * model, especially behind a local runtime serving whatever was pulled. A model
 * that cannot see returns an error naming itself, which is more useful than a
 * capability flag guessed here would be.
 */
export function providerCanCarryImages(providerId: string): boolean {
  return ["anthropic", "openai", "google", "groq", "cerebras", "custom"].includes(providerId);
}

export async function describeImage(providerId: string, req: VisionRequest): Promise<string> {
  switch (providerId) {
    case "anthropic":
      return anthropicVision(req);
    case "google":
      return googleVision(req);
    case "openai":
      return openAIVision("https://api.openai.com/v1/chat/completions", "OpenAI", req);
    case "groq":
      return openAIVision("https://api.groq.com/openai/v1/chat/completions", "Groq", req);
    case "cerebras":
      return openAIVision("https://api.cerebras.ai/v1/chat/completions", "Cerebras", req);
    case "custom":
      return openAIVision(`${customBaseUrl()}/chat/completions`, "Custom endpoint", req);
    default:
      throw new Error(`${providerId} cannot be shown images.`);
  }
}
