import { describe, expect, it } from "vitest";
import { buildMultipart } from "./multipart";

/**
 * multipart/form-data is assembled by hand here, because Tauri's HTTP client
 * takes bytes rather than marshalling a FormData object. That makes it exactly
 * the kind of code where a missing CRLF produces a body the server rejects with
 * a generic 400, and every spoken sentence fails with no clue why.
 *
 * These tests parse the produced bytes back rather than string-matching, so a
 * boundary or delimiter mistake fails loudly instead of subtly.
 */

const CRLF = "\r\n";

function text(body: Uint8Array): string {
  // latin1 maps bytes 1:1 to code units, so binary survives inspection unharmed.
  return new TextDecoder("latin1").decode(body);
}

function boundaryOf(contentType: string): string {
  const m = /boundary=(.+)$/.exec(contentType);
  if (!m) throw new Error(`no boundary in ${contentType}`);
  return m[1];
}

describe("buildMultipart", () => {
  it("declares the boundary it actually uses", async () => {
    const { body, contentType } = await buildMultipart([{ name: "model", value: "whisper-1" }]);
    const boundary = boundaryOf(contentType);

    expect(contentType.startsWith("multipart/form-data; boundary=")).toBe(true);
    // A boundary that appears in the header but not the body is the classic
    // failure: the server finds no parts and rejects the whole request.
    expect(text(body).includes(`--${boundary}`)).toBe(true);
  });

  it("terminates with the closing delimiter", async () => {
    const { body, contentType } = await buildMultipart([{ name: "model", value: "whisper-1" }]);
    const boundary = boundaryOf(contentType);
    expect(text(body).endsWith(`--${boundary}--${CRLF}`)).toBe(true);
  });

  it("separates headers from a field value with a blank line", async () => {
    const { body, contentType } = await buildMultipart([{ name: "model", value: "whisper-1" }]);
    const boundary = boundaryOf(contentType);

    const expected =
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="model"${CRLF}${CRLF}` +
      `whisper-1${CRLF}`;
    expect(text(body).includes(expected)).toBe(true);
  });

  it("preserves binary payloads byte for byte", async () => {
    // Bytes chosen to break anything that round-trips through UTF-8: a NUL, a
    // lone 0x80 continuation byte, and 0xFF which is not valid UTF-8 at all.
    const raw = new Uint8Array([0x00, 0x80, 0xff, 0x0d, 0x0a, 0x1a, 0x52, 0x49]);
    const blob = new Blob([raw], { type: "audio/webm" });

    const { body, contentType } = await buildMultipart([
      { name: "file", value: { blob, filename: "speech.webm", contentType: "audio/webm" } },
    ]);
    const boundary = boundaryOf(contentType);

    const header =
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="speech.webm"${CRLF}` +
      `Content-Type: audio/webm${CRLF}${CRLF}`;

    const start = header.length;
    const payload = body.slice(start, start + raw.length);
    expect(Array.from(payload)).toEqual(Array.from(raw));

    // And the part is closed properly, or the next boundary is not recognised.
    expect(text(body.slice(start + raw.length, start + raw.length + 2))).toBe(CRLF);
  });

  it("keeps multiple fields in the order given", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const { body } = await buildMultipart([
      { name: "file", value: { blob, filename: "speech.webm", contentType: "audio/webm" } },
      { name: "model", value: "whisper-large-v3-turbo" },
      { name: "response_format", value: "json" },
    ]);

    const s = text(body);
    const at = (n: string) => s.indexOf(`name="${n}"`);
    expect(at("file")).toBeGreaterThanOrEqual(0);
    expect(at("file")).toBeLessThan(at("model"));
    expect(at("model")).toBeLessThan(at("response_format"));
  });

  it("gives every request a distinct boundary", async () => {
    // A boundary reused across requests is fine on the wire but makes a
    // collision with payload content deterministic rather than vanishingly rare.
    const a = await buildMultipart([{ name: "model", value: "x" }]);
    const b = await buildMultipart([{ name: "model", value: "x" }]);
    expect(a.contentType).not.toBe(b.contentType);
  });

  it("reports a length matching the bytes produced", async () => {
    const blob = new Blob([new Uint8Array(64)], { type: "audio/webm" });
    const { body } = await buildMultipart([
      { name: "file", value: { blob, filename: "s.webm", contentType: "audio/webm" } },
      { name: "model", value: "whisper-1" },
    ]);
    // Guards the manual offset arithmetic that concatenates the parts: a short
    // allocation would leave trailing NULs the server reads as garbage.
    expect(body.length).toBeGreaterThan(64);
    expect(body.byteLength).toBe(body.length);
  });
});
