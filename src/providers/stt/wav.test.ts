import { describe, expect, it } from "vitest";
import { downmix, encodeWav, resample, TARGET_RATE } from "./wav";

/**
 * whisper.cpp reads the WAV header and refuses anything that is not 16 kHz mono
 * 16-bit PCM. A wrong field here does not degrade the transcript — it rejects the
 * request outright, and every spoken sentence fails identically. So the header is
 * parsed back out rather than trusted.
 */

function header(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (o: number, n: number) =>
    String.fromCharCode(...Array.from({ length: n }, (_, i) => view.getUint8(o + i)));
  return {
    riff: ascii(0, 4),
    riffSize: view.getUint32(4, true),
    wave: ascii(8, 4),
    fmt: ascii(12, 4),
    fmtSize: view.getUint32(16, true),
    format: view.getUint16(20, true),
    channels: view.getUint16(22, true),
    rate: view.getUint32(24, true),
    byteRate: view.getUint32(28, true),
    blockAlign: view.getUint16(32, true),
    bits: view.getUint16(34, true),
    data: ascii(36, 4),
    dataSize: view.getUint32(40, true),
  };
}

describe("encodeWav", () => {
  it("writes the one header shape whisper.cpp accepts", () => {
    const h = header(encodeWav(new Float32Array(100), TARGET_RATE));

    expect(h.riff).toBe("RIFF");
    expect(h.wave).toBe("WAVE");
    expect(h.fmt).toBe("fmt ");
    expect(h.data).toBe("data");
    expect(h.fmtSize).toBe(16);
    expect(h.format).toBe(1); // uncompressed PCM
    expect(h.channels).toBe(1);
    expect(h.rate).toBe(16000);
    expect(h.bits).toBe(16);
  });

  it("declares sizes that match the bytes it actually wrote", () => {
    const bytes = encodeWav(new Float32Array(1234), TARGET_RATE);
    const h = header(bytes);

    // A dataSize larger than the payload makes a reader run off the end; smaller
    // truncates the recording. Both read as "the mic did not work".
    expect(h.dataSize).toBe(1234 * 2);
    expect(bytes.length).toBe(44 + 1234 * 2);
    expect(h.riffSize).toBe(bytes.length - 8);
    expect(h.byteRate).toBe(16000 * 2);
    expect(h.blockAlign).toBe(2);
  });

  it("clamps rather than wrapping past full scale", () => {
    const bytes = encodeWav(new Float32Array([1.5, -1.5, 0]), TARGET_RATE);
    const view = new DataView(bytes.buffer);

    // Scaling an out-of-range sample without clamping overflows int16 and flips
    // its sign, which is an audible click in the middle of a word.
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
    expect(view.getInt16(48, true)).toBe(0);
  });
});

describe("downmix", () => {
  it("averages channels instead of dropping them", () => {
    const out = downmix([new Float32Array([1, 0]), new Float32Array([0, 1])]);
    expect(Array.from(out)).toEqual([0.5, 0.5]);
  });

  it("passes a mono capture through untouched", () => {
    const mono = new Float32Array([0.25, -0.25]);
    expect(downmix([mono])).toBe(mono);
  });
});

describe("resample", () => {
  it("lands on the target length for the real 48k -> 16k case", () => {
    expect(resample(new Float32Array(48000), 48000, TARGET_RATE).length).toBe(16000);
  });

  it("interpolates between samples rather than picking the nearest", () => {
    // 4 kHz -> 2 kHz over a ramp: every output should sit on the line, which a
    // nearest-neighbour decimation would also manage. Halving the rate the other
    // way is what separates them.
    const out = resample(new Float32Array([0, 1, 2, 3]), 4000, 8000);
    expect(Array.from(out)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3]);
  });

  it("is a no-op when the rates already match", () => {
    const input = new Float32Array([1, 2, 3]);
    expect(resample(input, TARGET_RATE, TARGET_RATE)).toBe(input);
  });
});
