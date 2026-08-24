/**
 * Minimal multipart/form-data builder.
 *
 * Tauri's HTTP client takes a byte body rather than marshalling a `FormData`
 * object the way the browser's fetch does, so the body is assembled by hand.
 * Returns raw bytes plus the exact Content-Type (the boundary must match).
 */

export interface MultipartField {
  name: string;
  value: string | { blob: Blob; filename: string; contentType: string };
}

export async function buildMultipart(
  fields: MultipartField[],
): Promise<{ body: Uint8Array; contentType: string }> {
  const boundary = `----Burrow${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];

  for (const field of fields) {
    if (typeof field.value === "string") {
      parts.push(
        encoder.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"\r\n\r\n${field.value}\r\n`,
        ),
      );
    } else {
      const { blob, filename, contentType } = field.value;
      parts.push(
        encoder.encode(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${field.name}"; filename="${filename}"\r\n` +
            `Content-Type: ${contentType}\r\n\r\n`,
        ),
      );
      parts.push(new Uint8Array(await blob.arrayBuffer()));
      parts.push(encoder.encode("\r\n"));
    }
  }
  parts.push(encoder.encode(`--${boundary}--\r\n`));

  const total = parts.reduce((n, p) => n + p.length, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    body.set(p, offset);
    offset += p.length;
  }

  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
