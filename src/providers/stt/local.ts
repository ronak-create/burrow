import { fetch } from "@tauri-apps/plugin-http";
import { useProviders } from "../registry";
import type { STTProvider } from "../types";
import { buildMultipart } from "./multipart";
import { toWav16kMono } from "./wav";

/**
 * Speech-to-text against a Whisper server on the user's own machine.
 *
 * This is the escape hatch the reasoning layer already has, applied to voice. The
 * README says the app runs with no keys at all; before this that was true of
 * reasoning and of spoken replies but not of voice input, which still required
 * Groq, OpenAI or Deepgram. Now every leg of the voice pipeline has a keyless
 * path, and the claim is true end to end.
 *
 * Deliberately a client, not a bundled engine. Shipping whisper.cpp and a model
 * file would add hundreds of megabytes to an installer and turn a code change
 * into a packaging project — the reason the project notes have deferred local STT
 * twice. Pointing at a server the user already runs costs nothing and covers
 * whisper.cpp, Speaches, LocalAI and vLLM alike.
 *
 * Like the custom LLM endpoint, the URL is read per request rather than captured
 * at module load, so editing it in Settings takes effect on the next sentence.
 */

export const DEFAULT_STT_BASE_URL = "http://127.0.0.1:8080/v1";

export const localWhisper: STTProvider = {
  id: "local-whisper",
  label: "Local Whisper",
  keyUrl: "https://github.com/ggml-org/whisper.cpp/tree/master/examples/server",
  keyOptional: true,
  freeformModel: true,

  async transcribe({ apiKey, audio, mimeType }) {
    const base = sttBaseUrl();
    const model = useProviders.getState().settings.sttModel.trim();
    const file = await asWav(audio, mimeType);

    const fields = [
      { name: "file", value: file },
      { name: "response_format", value: "json" },
      // Omitted when blank. whisper.cpp serves the one model it was started with
      // and ignores this; Speaches and LocalAI use it to select one, and would
      // rather have nothing than an empty string they must then reject.
      ...(model ? [{ name: "model", value: model }] : []),
    ];
    const { body, contentType } = await buildMultipart(fields);

    const post = (url: string) =>
      fetch(url, {
        method: "POST",
        headers: {
          "content-type": contentType,
          // Local servers generally want no auth at all, and some reject a
          // request carrying an empty bearer. A key is still sent when the user
          // stored one, since a self-hosted endpoint can be put behind a token.
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body,
      });

    const openAIRoute = `${base}/audio/transcriptions`;
    let res: Response;
    try {
      res = await post(openAIRoute);
    } catch (e) {
      // Nothing listening is by far the most common failure here, and the raw
      // transport error names neither the endpoint nor what to start.
      throw new Error(
        `Could not reach a local Whisper server at ${base}. ` +
          `Start one (whisper.cpp's server, Speaches or LocalAI), or pick a hosted ` +
          `provider under Settings. (${e instanceof Error ? e.message : String(e)})`,
      );
    }

    // whisper.cpp's own server predates the OpenAI audio route and answers on
    // /inference at the server root instead. Trying it on a 404 is what lets the
    // one genuinely keyless engine work without the user knowing which dialect
    // their server speaks.
    if (res.status === 404 || res.status === 405) {
      res = await post(nativeRoute(base));
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Local Whisper ${res.status}: ${detail.slice(0, 300)}`);
    }

    const json = (await res.json()) as { text?: string };
    return (json.text ?? "").trim();
  },
};

/**
 * Convert if we can, send what we have if we cannot.
 *
 * A container this runtime cannot decode is not a reason to fail the sentence —
 * an ffmpeg-backed server would have accepted the original bytes anyway. So a
 * decode failure downgrades to the raw recording rather than throwing.
 */
async function asWav(
  audio: Blob,
  mimeType: string,
): Promise<{ blob: Blob; filename: string; contentType: string }> {
  try {
    const wav = await toWav16kMono(audio);
    return {
      blob: new Blob([wav as BlobPart], { type: "audio/wav" }),
      filename: "speech.wav",
      contentType: "audio/wav",
    };
  } catch (e) {
    console.warn("WAV conversion failed, sending the original recording", e);
    const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("ogg") ? "ogg" : "wav";
    return { blob: audio, filename: `speech.${ext}`, contentType: mimeType };
  }
}

/** The configured base URL, normalised — shared by the sender and the probe. */
export function sttBaseUrl(): string {
  const raw = useProviders.getState().settings.sttBaseUrl || DEFAULT_STT_BASE_URL;
  // Tolerates a trailing slash, and someone pasting either server's full
  // transcription path straight out of its docs.
  return raw
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/audio\/transcriptions$/, "")
    .replace(/\/inference$/, "");
}

/** whisper.cpp's native route, which sits at the server root rather than under /v1. */
export function nativeRoute(base: string): string {
  return `${base.replace(/\/v1$/, "")}/inference`;
}

/**
 * Ask the endpoint which models it serves, for the model field.
 *
 * whisper.cpp has no /models route and yields nothing here, which is correct: it
 * serves exactly one model and the field is meant to stay blank for it.
 */
export async function listLocalWhisperModels(): Promise<string[]> {
  const base = sttBaseUrl();
  const res = await fetch(`${base}/models`, { method: "GET" });
  if (!res.ok) throw new Error(`${res.status} from ${base}/models`);
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  return (json.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id))
    .sort();
}
