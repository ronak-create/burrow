import { useEffect, useState } from "react";
import {
  IMAGE_PROVIDERS,
  LLM_PROVIDERS,
  SEARCH_PROVIDERS,
  STT_PROVIDERS,
  canChat,
  canGenerateImages,
  canSearchWeb,
  canSpeak,
  canTranscribe,
  useProviders,
} from "../providers/registry";
import { deleteApiKey, setApiKey } from "../workspace/api";
import { Icon } from "../ui/icons";
import { toastError, toastWarn } from "../ui/toast";
import { listCustomModels } from "../providers/llm/custom";
import { listCustomImageModels } from "../providers/image";
import { ACCENTS, useAccent, useTheme, type ThemePref } from "../ui/theme";

const THEMES: Array<{ pref: ThemePref; label: string }> = [
  { pref: "system", label: "System" },
  { pref: "light", label: "Light" },
  { pref: "dark", label: "Dark" },
];

type SettingsTab = "appearance" | "canvas" | "api";
const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "appearance", label: "Appearance" },
  { id: "canvas", label: "Canvas" },
  { id: "api", label: "API config" },
];

/**
 * BYOK settings.
 *
 * Keys are written straight to the OS keychain and never read back into this
 * screen — the UI only ever asks "is one stored?". That is why a configured
 * provider shows a status rather than a masked value.
 */
export default function Settings({ onClose }: { onClose: () => void }) {
  const providers = useProviders();
  const theme = useTheme();
  const accent = useAccent();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [found, setFound] = useState<string[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [imageFound, setImageFound] = useState<string[]>([]);
  const [detectingImage, setDetectingImage] = useState(false);
  const [tab, setTab] = useState<SettingsTab>("appearance");

  async function detect() {
    setDetecting(true);
    try {
      const ids = await listCustomModels();
      setFound(ids);
      if (ids.length === 0) {
        toastWarn("That endpoint answered but listed no models.");
      } else if (!providers.settings.llmModel.trim()) {
        // Nothing chosen yet, so pick one rather than making them retype it.
        providers.update({ llmModel: ids[0] });
      }
    } catch (e) {
      toastError(e);
    } finally {
      setDetecting(false);
    }
  }

  async function detectImages() {
    setDetectingImage(true);
    try {
      const ids = await listCustomImageModels();
      setImageFound(ids);
      if (ids.length === 0) {
        toastWarn("That endpoint answered but listed no models.");
      } else if (!providers.settings.imageModel.trim()) {
        providers.update({ imageModel: ids[0] });
      }
    } catch (e) {
      toastError(e);
    } finally {
      setDetectingImage(false);
    }
  }

  useEffect(() => {
    void providers.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(id: string) {
    const key = (drafts[id] ?? "").trim();
    if (!key) return;
    setSaving(id);
    try {
      await setApiKey(id, key);
      setDrafts((d) => ({ ...d, [id]: "" }));
      await providers.refresh();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(null);
    }
  }

  async function remove(id: string) {
    setSaving(id);
    try {
      await deleteApiKey(id);
      await providers.refresh();
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(null);
    }
  }

  /**
   * Only the keys the current selection actually needs.
   *
   * Listing every provider meant six slots for a setup that uses one, and it read
   * as six things to do before the app worked. This follows the pickers above
   * instead. It is usually a single row, and two only when reasoning and speech
   * are on different providers — which is a real configuration, so the list is
   * derived rather than hardcoded to one. A keyless provider contributes nothing.
   */
  const llm = LLM_PROVIDERS.find((p) => p.id === providers.settings.llmProvider);
  const stt = STT_PROVIDERS.find((p) => p.id === providers.settings.sttProvider);
  const img = IMAGE_PROVIDERS.find((p) => p.id === providers.settings.imageProvider);
  const web = SEARCH_PROVIDERS.find((p) => p.id === providers.settings.searchProvider);
  const keyRows = [
    ...(llm && !llm.keyOptional
      ? [{ id: llm.id, label: llm.label, use: "Reasoning", keyUrl: llm.keyUrl }]
      : []),
    ...(stt ? [{ id: stt.id, label: stt.label, use: "Speech-to-text", keyUrl: stt.keyUrl }] : []),
    ...(img && !img.keyOptional
      ? [{ id: img.id, label: img.label, use: "Image generation", keyUrl: img.keyUrl }]
      : []),
    ...(web ? [{ id: web.id, label: web.label, use: "Web search", keyUrl: web.keyUrl }] : []),
  ].filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i);

  const capabilities = [
    { label: "Canvas, notes, frames, undo", on: true, note: "Always available, no key needed" },
    { label: "Assistant", on: canChat(providers), note: "Needs a reasoning provider key" },
    { label: "Voice input", on: canTranscribe(providers), note: "Needs a speech-to-text key" },
    {
      label: "Spoken replies",
      on: canSpeak(providers),
      note: providers.speechAvailable ? "Uses your OS voices, no key needed" : "OS speech engine unavailable",
    },
    { label: "Paper search", on: true, note: "Four open indexes, no key needed" },
    { label: "Web search", on: canSearchWeb(providers), note: "Needs a web search key" },
    {
      label: "Image generation",
      on: canGenerateImages(providers),
      note: "Needs an image provider and model",
    },
  ];

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Page header. Fixed above the scroll area, so Back is always reachable. */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 22px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        <button
          onClick={onClose}
          title="Back"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "var(--text-muted)",
            fontSize: 14,
          }}
        >
          <Icon name="back" size={16} /> Back
        </button>
        <h2 style={{ fontSize: 16, margin: 0, fontWeight: 600 }}>Settings</h2>
      </header>

      <div
        style={{
          display: "flex",
          gap: 4,
          padding: "0 22px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "10px 14px",
              fontSize: 13,
              fontWeight: 500,
              color: tab === t.id ? "var(--text)" : "var(--text-muted)",
              borderBottom: `2px solid ${tab === t.id ? "var(--accent)" : "transparent"}`,
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 620, margin: "0 auto", padding: "24px 22px 60px" }}>
        {tab === "appearance" && (
        <Section title="Appearance">
          <Row label="Theme">
            <div style={{ display: "flex", gap: 4 }}>
              {THEMES.map((t) => (
                <button
                  key={t.pref}
                  onClick={() => theme.setPref(t.pref)}
                  style={{
                    padding: "5px 12px",
                    borderRadius: "var(--r-sm)",
                    fontSize: 13,
                    border: `1px solid ${theme.pref === t.pref ? "var(--accent-line)" : "var(--border)"}`,
                    background: theme.pref === t.pref ? "var(--accent-wash)" : "transparent",
                    color: theme.pref === t.pref ? "var(--accent)" : "var(--text-muted)",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </Row>

          <Row label="Accent">
            <div style={{ display: "flex" }}>
              {ACCENTS.map((a, i) => (
                <button
                  key={a.pref}
                  onClick={() => accent.setAccent(a.pref)}
                  title={a.label}
                  aria-label={a.label}
                  aria-pressed={accent.accent === a.pref}
                  style={{
                    width: 32,
                    height: 32,
                    display: "grid",
                    placeItems: "center",
                    background: a.swatch,
                    border: "1px solid var(--border)",
                    borderLeft: i === 0 ? "1px solid var(--border)" : "none",
                    borderTopLeftRadius: i === 0 ? "var(--r-sm)" : 0,
                    borderBottomLeftRadius: i === 0 ? "var(--r-sm)" : 0,
                    borderTopRightRadius: i === ACCENTS.length - 1 ? "var(--r-sm)" : 0,
                    borderBottomRightRadius: i === ACCENTS.length - 1 ? "var(--r-sm)" : 0,
                  }}
                >
                  {accent.accent === a.pref && (
                    <Icon
                      name="check"
                      size={14}
                      style={{ color: "#fff", filter: "drop-shadow(0 0 1.5px rgba(0,0,0,0.7))" }}
                    />
                  )}
                </button>
              ))}
            </div>
          </Row>

          <div
            style={{
              marginTop: 10,
              borderRadius: "var(--r-md)",
              border: "1px solid var(--border)",
              background: "var(--surface)",
              overflow: "hidden",
            }}
          >
            {/* Title bar: a few tab placeholders, and the traffic lights every
                mock browser chrome uses — decorative, not accent-tinted. */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 14px",
                background: "var(--surface-2)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              {[46, 46, 46].map((w, i) => (
                <span
                  key={i}
                  style={{ width: w, height: 8, borderRadius: 99, background: "var(--border-strong)" }}
                />
              ))}
              <span style={{ flex: 1 }} />
              <span style={{ width: 9, height: 9, borderRadius: 99, background: "#3ecf8e" }} />
              <span style={{ width: 9, height: 9, borderRadius: 99, background: "#e5484d" }} />
            </div>

            {/* Body: a highlighted row in the current accent, plain rows beside
                it, and a blank side panel — enough of a "screen" to read the
                colour the way it will actually sit against the UI. */}
            <div style={{ display: "flex", gap: 10, padding: 14 }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                <span
                  style={{
                    width: 120,
                    height: 8,
                    borderRadius: 99,
                    background: "var(--border-strong)",
                    marginBottom: 4,
                  }}
                />
                <div
                  style={{
                    height: 30,
                    borderRadius: "var(--r-sm)",
                    background: "var(--accent-wash)",
                    border: "1px solid var(--accent-line)",
                    display: "flex",
                    alignItems: "center",
                    padding: "0 10px",
                  }}
                >
                  <span
                    style={{
                      width: "60%",
                      height: 7,
                      borderRadius: 99,
                      background: "var(--accent)",
                    }}
                  />
                </div>
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    style={{
                      height: 30,
                      borderRadius: "var(--r-sm)",
                      background: "var(--surface-2)",
                      display: "flex",
                      alignItems: "center",
                      padding: "0 10px",
                    }}
                  >
                    <span
                      style={{
                        width: "45%",
                        height: 7,
                        borderRadius: 99,
                        background: "var(--border-strong)",
                      }}
                    />
                  </div>
                ))}
              </div>
              <div
                style={{
                  width: 56,
                  borderRadius: "var(--r-sm)",
                  background: "var(--surface-2)",
                }}
              />
            </div>
          </div>
        </Section>
        )}

        {tab === "canvas" && (
        <Section title="Canvas">
          <Row label="Pattern">
            <div style={{ display: "flex", gap: 4 }}>
              {(["dots", "grid", "plain"] as const).map((p) => {
                const on = providers.settings.canvasPattern === p;
                return (
                  <button
                    key={p}
                    onClick={() => providers.update({ canvasPattern: p })}
                    style={{
                      padding: "5px 12px",
                      borderRadius: "var(--r-sm)",
                      fontSize: 13,
                      textTransform: "capitalize",
                      border: `1px solid ${on ? "var(--accent-line)" : "var(--border)"}`,
                      background: on ? "var(--accent-wash)" : "transparent",
                      color: on ? "var(--accent)" : "var(--text-muted)",
                    }}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </Row>

          <Row label="Canvas shade">
            <div style={{ display: "flex", gap: 8 }}>
              {([0, 100] as const).map((v) => {
                const on = providers.settings.canvasShade === v;
                return (
                  <button
                    key={v}
                    onClick={() => providers.update({ canvasShade: v })}
                    aria-pressed={on}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "6px 12px",
                      borderRadius: "var(--r-sm)",
                      fontSize: 13,
                      border: `1px solid ${on ? "var(--accent-line)" : "var(--border)"}`,
                      background: on ? "var(--accent-wash)" : "transparent",
                      color: on ? "var(--accent)" : "var(--text-muted)",
                    }}
                  >
                    <span
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: 99,
                        border: "1px solid var(--border-strong)",
                        background: v === 0 ? "#000000" : "#ffffff",
                      }}
                    />
                    {v === 0 ? "Black" : "White"}
                  </button>
                );
              })}
            </div>
          </Row>

          <div
            style={{
              marginTop: 10,
              height: 160,
              borderRadius: "var(--r-md)",
              border: "1px solid var(--border)",
              position: "relative",
              overflow: "hidden",
              background: `color-mix(in srgb, var(--card) ${providers.settings.canvasShade}%, var(--bg))`,
              backgroundImage:
                providers.settings.canvasPattern === "dots"
                  ? "radial-gradient(var(--canvas-dot) 1.6px, transparent 1.6px)"
                  : providers.settings.canvasPattern === "grid"
                    ? "linear-gradient(var(--canvas-dot) 1px, transparent 1px), linear-gradient(90deg, var(--canvas-dot) 1px, transparent 1px)"
                    : "none",
              backgroundSize:
                providers.settings.canvasPattern === "plain" ? undefined : "22px 22px",
            }}
          >
            {/* A couple of block placeholders, so the pattern reads as a canvas
                backdrop rather than an abstract swatch. */}
            <div
              style={{
                position: "absolute",
                top: 20,
                left: 20,
                width: 70,
                height: 44,
                borderRadius: "var(--r-sm)",
                background: "var(--card)",
                border: "1px solid var(--border-strong)",
                boxShadow: "var(--shadow-pop)",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 72,
                left: 110,
                width: 90,
                height: 56,
                borderRadius: "var(--r-sm)",
                background: "var(--card)",
                border: "1px solid var(--accent-line)",
                boxShadow: "var(--shadow-pop)",
              }}
            />
          </div>
        </Section>
        )}

        {tab === "api" && (
        <>
        <Section title="What's working">
          {capabilities.map((c) => (
            <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 0" }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 99,
                  background: c.on ? "var(--ok)" : "var(--text-faint)",
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 14, color: c.on ? "var(--text)" : "var(--text-muted)" }}>
                {c.label}
              </span>
              <span style={{ fontSize: 12, color: "var(--text-faint)", marginLeft: "auto" }}>
                {c.note}
              </span>
            </div>
          ))}
        </Section>

        <Section title="Model">
          <Row label="Provider">
            <select
              value={providers.settings.llmProvider}
              onChange={(e) => {
                // Carry the model along, or the app would keep a model id that the
                // newly selected provider does not recognise.
                const next = LLM_PROVIDERS.find((p) => p.id === e.target.value);
                providers.update({
                  llmProvider: e.target.value,
                  // A free-typed provider keeps whatever the user last typed; a
                  // listed one snaps to its first model so the id is never stale.
                  ...(next?.freeformModel
                    ? {}
                    : next?.models[0]
                      ? { llmModel: next.models[0].id }
                      : {}),
                });
              }}
              style={selectStyle}
            >
              {LLM_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Row>
          {llm?.freeformModel ? (
            <>
              <Row label="Endpoint">
                <input
                  value={providers.settings.customBaseUrl}
                  onChange={(e) => providers.update({ customBaseUrl: e.target.value })}
                  placeholder="http://127.0.0.1:11434/v1"
                  style={{ ...selectStyle, fontFamily: "var(--font-mono)", fontSize: 13 }}
                />
              </Row>
              <Row label="Model">
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    list="burrow-local-models"
                    value={providers.settings.llmModel}
                    onChange={(e) => providers.update({ llmModel: e.target.value })}
                    placeholder="e.g. gemma4:e4b"
                    style={{ ...selectStyle, fontFamily: "var(--font-mono)", fontSize: 13 }}
                  />
                  <datalist id="burrow-local-models">
                    {found.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                  <button
                    onClick={() => void detect()}
                    disabled={detecting}
                    title="Ask the endpoint which models it serves"
                    style={{
                      whiteSpace: "nowrap",
                      padding: "6px 11px",
                      borderRadius: "var(--r-sm)",
                      fontSize: 13,
                      border: "1px solid var(--border)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {detecting ? "…" : "Detect"}
                  </button>
                </span>
              </Row>
              <div style={{ fontSize: 12, color: "var(--text-faint)", paddingTop: 2 }}>
                Any OpenAI-compatible server — Ollama, LM Studio, llama.cpp, vLLM or a
                gateway. No key is required for a local one. The model must support
                tool calling, or the assistant can talk but cannot touch the board.
              </div>
            </>
          ) : (
            <Row label="Model">
              <select
                value={providers.settings.llmModel}
                onChange={(e) => providers.update({ llmModel: e.target.value })}
                style={selectStyle}
              >
                {(llm?.models ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Row>
          )}
          <Row label="Speech-to-text">
            <select
              value={providers.settings.sttProvider}
              onChange={(e) => providers.update({ sttProvider: e.target.value })}
              style={selectStyle}
            >
              {STT_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Row>
        </Section>

        <Section title="Research and images">
          <Row label="Web search">
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <select
                value={providers.settings.searchProvider}
                onChange={(e) => providers.update({ searchProvider: e.target.value })}
                style={selectStyle}
              >
                {SEARCH_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <InfoTip text="Paper search across arXiv, OpenAlex, Semantic Scholar and PubMed is free and needs no key. General web search does — every usable API is paid, and scraping a search engine is not something this app will do." />
            </span>
          </Row>

          <Row label="Images">
            <select
              value={providers.settings.imageProvider}
              onChange={(e) => {
                // Same rule as the model picker: never leave a model id behind that
                // the newly selected provider does not recognise.
                const next = IMAGE_PROVIDERS.find((p) => p.id === e.target.value);
                providers.update({
                  imageProvider: e.target.value,
                  ...(next?.freeformModel
                    ? {}
                    : next?.models[0]
                      ? { imageModel: next.models[0].id }
                      : {}),
                });
              }}
              style={selectStyle}
            >
              {IMAGE_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Row>
          {img?.freeformModel ? (
            <>
              <Row label="Endpoint">
                <input
                  value={providers.settings.imageBaseUrl}
                  onChange={(e) => providers.update({ imageBaseUrl: e.target.value })}
                  placeholder="http://127.0.0.1:8080/v1"
                  style={{ ...selectStyle, fontFamily: "var(--font-mono)", fontSize: 13 }}
                />
              </Row>
              <Row label="Model">
                <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    list="burrow-local-image-models"
                    value={providers.settings.imageModel}
                    onChange={(e) => providers.update({ imageModel: e.target.value })}
                    placeholder="e.g. stablediffusion"
                    style={{ ...selectStyle, fontFamily: "var(--font-mono)", fontSize: 13 }}
                  />
                  <datalist id="burrow-local-image-models">
                    {imageFound.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                  <button
                    onClick={() => void detectImages()}
                    disabled={detectingImage}
                    title="Ask the endpoint which models it serves"
                    style={{
                      whiteSpace: "nowrap",
                      padding: "6px 11px",
                      borderRadius: "var(--r-sm)",
                      fontSize: 13,
                      border: "1px solid var(--border)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {detectingImage ? "…" : "Detect"}
                  </button>
                </span>
              </Row>
              <div style={{ fontSize: 12, color: "var(--text-faint)", paddingTop: 2 }}>
                Any server speaking the OpenAI images API — LocalAI, LiteLLM, a gateway,
                or a Stable Diffusion front-end that exposes it. It must return base64;
                a link-only endpoint cannot be stored in the workspace.
              </div>
            </>
          ) : (
            <Row label="Model">
              <select
                value={providers.settings.imageModel}
                onChange={(e) => providers.update({ imageModel: e.target.value })}
                style={selectStyle}
              >
                {(img?.models ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Row>
          )}
        </Section>

        <Section title="API keys">
          {keyRows.map((row) => {
            const configured = providers.configured.includes(row.id);
            return (
              <div key={row.id} style={{ padding: "9px 0", borderBottom: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{row.label}</span>
                  <span style={{ fontSize: 12, color: "var(--text-faint)" }}>{row.use}</span>
                  {configured && (
                    <span style={{ fontSize: 12, color: "var(--ok)", marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Icon name="check" size={12} /> stored
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="password"
                    value={drafts[row.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [row.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && void save(row.id)}
                    placeholder={configured ? "Replace stored key…" : "Paste key…"}
                    style={{
                      flex: 1,
                      background: "var(--surface-2)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--r-sm)",
                      padding: "6px 10px",
                      outline: "none",
                      fontSize: 13,
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                  <button
                    disabled={!drafts[row.id]?.trim() || saving === row.id}
                    onClick={() => void save(row.id)}
                    style={{
                      padding: "0 12px",
                      borderRadius: "var(--r-sm)",
                      fontSize: 13,
                      background: drafts[row.id]?.trim() ? "var(--accent)" : "var(--surface-2)",
                      color: drafts[row.id]?.trim() ? "var(--on-accent)" : "var(--text-faint)",
                    }}
                  >
                    Save
                  </button>
                  {configured && (
                    <button
                      onClick={() => void remove(row.id)}
                      style={{ padding: "0 10px", fontSize: 13, color: "var(--danger)" }}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <a
                  href={row.keyUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 11, color: "var(--text-faint)", textDecoration: "none" }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    Get a key <Icon name="external" size={10} />
                  </span>
                </a>
              </div>
            );
          })}
        </Section>
        </>
        )}

        </div>
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  padding: "5px 9px",
  fontSize: 13,
  outline: "none",
  minWidth: 200,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div
        style={{
          fontSize: 12,
          color: "var(--text-faint)",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "5px 0" }}>
      <span style={{ fontSize: 14, flex: 1 }}>{label}</span>
      {children}
    </div>
  );
}

/** An (i) button that reveals a wrapped block of text beside it — nothing else. */
function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        aria-label="More info"
        style={{
          display: "grid",
          placeItems: "center",
          width: 22,
          height: 22,
          borderRadius: 99,
          color: "var(--text-faint)",
          flexShrink: 0,
        }}
      >
        <Icon name="info" size={14} />
      </button>
      {open && (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            top: "50%",
            left: "calc(100% + 8px)",
            transform: "translateY(-50%)",
            width: 220,
            padding: "8px 10px",
            borderRadius: "var(--r-sm)",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-pop)",
            fontSize: 12,
            lineHeight: 1.5,
            color: "var(--text-muted)",
            whiteSpace: "normal",
            zIndex: 20,
          }}
        >
          {text}
        </div>
      )}
    </span>
  );
}
