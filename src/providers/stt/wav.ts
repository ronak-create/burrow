/**
 * webm/opus -> 16 kHz mono WAV.
 *
 * Only the local path needs this. Hosted Whisper endpoints take the recorder's
 * output as-is, and converting for them would be strictly worse: WAV is
 * uncompressed, so it would multiply the upload of every spoken sentence.
 *
 * whisper.cpp's bundled server is the reason this exists. Unless it is built
 * against ffmpeg it decodes nothing but WAV, and its reader requires 16 kHz mono
 * specifically — the rate Whisper's own frontend runs at. `MediaRecorder` in
 * WebView2 produces 48 kHz Opus in a webm container, so without this step the
 * server named in the project notes as *the* zero-key path is the one server the
 * feature cannot talk to.
 *
 * Servers that do wrap ffmpeg (Speaches, LocalAI, vLLM) accept WAV equally well,
 * so one conversion covers every local option rather than branching on which.
 */

/** Whisper resamples everything to this internally; arriving at it is free. */
export const TARGET_RATE = 16000;

/**
 * Average all channels down to one.
 *
 * A microphone capture is mono already, but a stream routed through a virtual
 * device or a loopback capture is not, and taking only channel 0 would silently
 * drop half of a stereo recording.
 */
export function downmix(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];

  const out = new Float32Array(channels[0].length);
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (const ch of channels) sum += ch[i] ?? 0;
    out[i] = sum / channels.length;
  }
  return out;
}

/**
 * Linear resample. Used only when the decoder could not be asked for the target
 * rate directly; `OfflineAudioContext` normally does this in native code.
 */
export function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to || input.length === 0) return input;

  const ratio = from / to;
  const out = new Float32Array(Math.max(1, Math.round(input.length / ratio)));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, input.length - 1);
    // Interpolate rather than taking the nearest sample: plain decimation of
    // 48 kHz speech aliases audibly, and the transcript degrades with it.
    out[i] = input[lo] + (input[hi] - input[lo]) * (pos - lo);
  }
  return out;
}

/** 16-bit PCM WAV. The only container whisper.cpp reads without ffmpeg. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);

  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header length
  view.setUint16(20, 1, true); // format: uncompressed PCM
  view.setUint16(22, 1, true); // channels
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate: rate * channels * bytes
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i++) {
    // Clamp before scaling. A sample above 1.0 — which a gain stage can produce —
    // would otherwise wrap to the opposite sign and click.
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Uint8Array(buf);
}

/**
 * Decode a recording and re-emit it as 16 kHz mono WAV.
 *
 * Decoding runs through `OfflineAudioContext` at the target rate, which makes the
 * resample the browser's problem rather than ours — `decodeAudioData` resamples
 * to the context's rate on the way out. The manual `resample` above is the
 * backstop for a runtime that ignores that.
 */
export async function toWav16kMono(blob: Blob): Promise<Uint8Array> {
  const bytes = await blob.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, TARGET_RATE);
  const decoded = await ctx.decodeAudioData(bytes);

  const channels: Float32Array[] = [];
  for (let i = 0; i < decoded.numberOfChannels; i++) channels.push(decoded.getChannelData(i));

  const mono = resample(downmix(channels), decoded.sampleRate, TARGET_RATE);
  return encodeWav(mono, TARGET_RATE);
}
