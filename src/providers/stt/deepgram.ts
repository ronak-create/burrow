import { fetch } from "@tauri-apps/plugin-http";
import type { STTProvider } from "../types";

/**
 * Deepgram. Unlike the Whisper-compatible endpoints this takes the raw audio bytes
 * as the request body with the codec in Content-Type — no multipart wrapper.
 */
export const deepgram: STTProvider = {
  id: "deepgram",
  label: "Deepgram",
  keyUrl: "https://console.deepgram.com/",

  async transcribe({ apiKey, audio, mimeType }) {
    const res = await fetch(
      "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true",
      {
        method: "POST",
        headers: { authorization: `Token ${apiKey}`, "content-type": mimeType },
        body: new Uint8Array(await audio.arrayBuffer()),
      },
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Deepgram ${res.status}: ${detail.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
    };
    return (json.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "").trim();
  },
};
