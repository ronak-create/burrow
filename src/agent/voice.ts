import { invoke } from "@tauri-apps/api/core";
import { activeSTT, keyFor } from "../providers/registry";

/**
 * Hold-to-talk capture and speech playback.
 *
 * Both halves depend on findings from the M1 spike:
 *   - getUserMedia works in WebView2 only because tauri.conf.json passes
 *     --use-fake-ui-for-media-stream, which auto-grants the permission prompt
 *     (it does not fake the device). Without it, getUserMedia hangs forever.
 *   - speechSynthesis exposes no voices in WebView2, so speaking goes through the
 *     OS voices via Rust instead of the browser API.
 */

function pickMime(): string {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

export class Recorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private mime = "";

  get active(): boolean {
    return this.recorder?.state === "recording";
  }

  async start(): Promise<void> {
    if (this.active) return;
    // Bounded: a silent hang here would leave the UI stuck "listening" forever.
    this.stream = await Promise.race([
      navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("Microphone did not respond. Check Windows mic permissions.")), 8000),
      ),
    ]);

    this.mime = pickMime();
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime } : undefined);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
  }

  /** Stops capture and returns the recording, or null if nothing was captured. */
  async stop(): Promise<{ blob: Blob; mimeType: string } | null> {
    const rec = this.recorder;
    if (!rec || rec.state === "inactive") {
      this.cleanup();
      return null;
    }
    const done = new Promise<void>((res) => {
      rec.onstop = () => res();
    });
    rec.stop();
    await done;

    const mimeType = this.mime || rec.mimeType || "audio/webm";
    const blob = new Blob(this.chunks, { type: mimeType });
    this.cleanup();
    return blob.size > 0 ? { blob, mimeType } : null;
  }

  cancel(): void {
    try {
      this.recorder?.stop();
    } catch {
      /* already stopped */
    }
    this.cleanup();
  }

  private cleanup(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
  }
}

export async function transcribe(blob: Blob, mimeType: string): Promise<string> {
  const provider = activeSTT();
  const apiKey = await keyFor(provider.id);
  return provider.transcribe({ apiKey, audio: blob, mimeType });
}

/** Speak through the OS voices. Never throws — a mute machine must not break a turn. */
export async function speak(text: string): Promise<void> {
  try {
    await invoke("speak", { text });
  } catch (e) {
    console.warn("speak failed", e);
  }
}

export async function stopSpeaking(): Promise<void> {
  try {
    await invoke("stop_speaking");
  } catch {
    /* nothing to stop */
  }
}
