import { fetch } from "@tauri-apps/plugin-http";
import type { STTProvider } from "../types";
import { buildMultipart } from "./multipart";

/**
 * Whisper transcription over the OpenAI-compatible audio endpoint, which Groq and
 * OpenAI both expose with the same shape.
 *
 * Groq is the default because it is fast and very cheap, which matters when every
 * spoken sentence costs a round trip. This is the M1 path; a fully local
 * whisper.cpp provider lands in M2 and removes the key requirement entirely.
 */

function whisperProvider(cfg: {
  id: string;
  label: string;
  url: string;
  model: string;
  keyUrl: string;
}): STTProvider {
  return {
    id: cfg.id,
    label: cfg.label,
    keyUrl: cfg.keyUrl,

    async transcribe({ apiKey, audio, mimeType }) {
      const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("ogg") ? "ogg" : "wav";
      const { body, contentType } = await buildMultipart([
        { name: "file", value: { blob: audio, filename: `speech.${ext}`, contentType: mimeType } },
        { name: "model", value: cfg.model },
        { name: "response_format", value: "json" },
      ]);

      const res = await fetch(cfg.url, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": contentType },
        body,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`${cfg.label} ${res.status}: ${detail.slice(0, 300)}`);
      }

      const json = (await res.json()) as { text?: string };
      return (json.text ?? "").trim();
    },
  };
}

export const groqWhisper = whisperProvider({
  id: "groq",
  label: "Groq Whisper",
  url: "https://api.groq.com/openai/v1/audio/transcriptions",
  model: "whisper-large-v3-turbo",
  keyUrl: "https://console.groq.com/keys",
});

export const openaiWhisper = whisperProvider({
  id: "openai",
  label: "OpenAI Whisper",
  url: "https://api.openai.com/v1/audio/transcriptions",
  model: "whisper-1",
  keyUrl: "https://platform.openai.com/api-keys",
});
