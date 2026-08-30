import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The local path has to work without the user knowing which dialect their
 * Whisper server speaks. whisper.cpp answers on /inference, everything else on
 * the OpenAI route, and getting that wrong fails every sentence with a 404 that
 * says nothing about why. These tests pin the routing and the URL normalisation,
 * because both are invisible until voice is silently broken.
 */

const settings = {
  sttBaseUrl: "http://127.0.0.1:8080/v1",
  sttModel: "",
};

vi.mock("../registry", () => ({
  useProviders: { getState: () => ({ settings }) },
}));

const fetchMock = vi.fn();
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: (...a: unknown[]) => fetchMock(...a) }));

// The real converter needs OfflineAudioContext, which no test runner has. What
// matters here is routing, so it is stubbed; wav.test.ts covers the encoder.
vi.mock("./wav", () => ({ toWav16kMono: async () => new Uint8Array([1, 2, 3]) }));

const { localWhisper, listLocalWhisperModels, nativeRoute, sttBaseUrl } = await import("./local");

function ok(text: string) {
  return { ok: true, status: 200, json: async () => ({ text }) };
}
function notFound() {
  return { ok: false, status: 404, text: async () => "not found" };
}

const audio = new Blob([new Uint8Array([0])], { type: "audio/webm" });
const call = () => localWhisper.transcribe({ apiKey: "", audio, mimeType: "audio/webm" });
const urlsHit = () => fetchMock.mock.calls.map((c) => c[0] as string);

beforeEach(() => {
  fetchMock.mockReset();
  settings.sttBaseUrl = "http://127.0.0.1:8080/v1";
  settings.sttModel = "";
});

describe("sttBaseUrl", () => {
  it("normalises the paths a user is most likely to paste", () => {
    const cases = [
      "http://127.0.0.1:8080/v1/",
      "http://127.0.0.1:8080/v1/audio/transcriptions",
      "  http://127.0.0.1:8080/v1  ",
    ];
    for (const raw of cases) {
      settings.sttBaseUrl = raw;
      expect(sttBaseUrl()).toBe("http://127.0.0.1:8080/v1");
    }
  });

  it("strips whisper.cpp's own path back to a base", () => {
    settings.sttBaseUrl = "http://127.0.0.1:8080/inference";
    expect(sttBaseUrl()).toBe("http://127.0.0.1:8080");
  });

  it("falls back to the default when the field is emptied", () => {
    settings.sttBaseUrl = "";
    expect(sttBaseUrl()).toBe("http://127.0.0.1:8080/v1");
  });
});

describe("nativeRoute", () => {
  it("drops /v1, because whisper.cpp serves /inference from the root", () => {
    expect(nativeRoute("http://127.0.0.1:8080/v1")).toBe("http://127.0.0.1:8080/inference");
    expect(nativeRoute("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080/inference");
  });
});

describe("localWhisper.transcribe", () => {
  it("uses the OpenAI route when the server has one", async () => {
    fetchMock.mockResolvedValueOnce(ok("  hello  "));

    expect(await call()).toBe("hello");
    expect(urlsHit()).toEqual(["http://127.0.0.1:8080/v1/audio/transcriptions"]);
  });

  it("retries whisper.cpp's route on a 404", async () => {
    fetchMock.mockResolvedValueOnce(notFound()).mockResolvedValueOnce(ok("from whisper.cpp"));

    expect(await call()).toBe("from whisper.cpp");
    expect(urlsHit()).toEqual([
      "http://127.0.0.1:8080/v1/audio/transcriptions",
      "http://127.0.0.1:8080/inference",
    ]);
  });

  it("reports the second failure, not the first, when neither route exists", async () => {
    fetchMock.mockResolvedValueOnce(notFound()).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "model failed to load",
    });

    await expect(call()).rejects.toThrow(/500.*model failed to load/);
  });

  it("names the endpoint and a fix when nothing is listening", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    // The overwhelmingly common failure: no server running. A bare transport
    // error names neither the address it tried nor what to start.
    const err = await call().catch((e: Error) => e.message);
    expect(err).toMatch(/127\.0\.0\.1:8080/);
    expect(err).toMatch(/whisper\.cpp/);
    expect(err).toMatch(/ECONNREFUSED/);
  });

  it("omits the model field when blank, and sends it when set", async () => {
    const bodyOf = () => {
      const calls = fetchMock.mock.calls;
      const init = calls[calls.length - 1][1] as { body: Uint8Array };
      return new TextDecoder("latin1").decode(init.body);
    };

    fetchMock.mockResolvedValueOnce(ok("x"));
    await call();
    // whisper.cpp serves one model and Speaches rejects an empty id, so a blank
    // field must mean "do not send one" rather than "send nothing-in-particular".
    expect(bodyOf()).not.toContain('name="model"');

    settings.sttModel = "Systran/faster-whisper-small";
    fetchMock.mockResolvedValueOnce(ok("x"));
    await call();
    expect(bodyOf()).toContain("Systran/faster-whisper-small");
  });

  it("sends no Authorization header without a key", async () => {
    fetchMock.mockResolvedValueOnce(ok("x"));
    await call();

    // Some local servers reject a request carrying an empty bearer outright.
    const headers = (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers;
    expect(headers.authorization).toBeUndefined();
    expect(headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
  });

  it("sends the key when the user put their server behind one", async () => {
    fetchMock.mockResolvedValueOnce(ok("x"));
    await localWhisper.transcribe({ apiKey: "tok", audio, mimeType: "audio/webm" });

    const headers = (fetchMock.mock.calls[0][1] as { headers: Record<string, string> }).headers;
    expect(headers.authorization).toBe("Bearer tok");
  });
});

describe("listLocalWhisperModels", () => {
  it("sorts the ids and drops entries without one", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: "small" }, {}, { id: "base" }] }),
    });

    expect(await listLocalWhisperModels()).toEqual(["base", "small"]);
    expect(urlsHit()).toEqual(["http://127.0.0.1:8080/v1/models"]);
  });
});
