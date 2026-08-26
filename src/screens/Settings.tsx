import { useEffect, useState } from "react";
import {
  LLM_PROVIDERS,
  STT_PROVIDERS,
  canChat,
  canSpeak,
  canTranscribe,
  useProviders,
} from "../providers/registry";
import { deleteApiKey, setApiKey } from "../workspace/api";
import { Icon } from "../ui/icons";
import { toastError, toastWarn } from "../ui/toast";
import { listCustomModels } from "../providers/llm/custom";
import { ACCENTS, resolvedTheme, useAccent, useTheme, type ThemePref } from "../ui/theme";

const THEMES: Array<{ pref: ThemePref; label: string }> = [
  { pref: "system", label: "System" },
  { pref: "light", label: "Light" },
  { pref: "dark", label: "Dark" },
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
  const keyRows = [
    ...(llm && !llm.keyOptional
      ? [{ id: llm.id, label: llm.label, use: "Reasoning", keyUrl: llm.keyUrl }]
      : []),
    ...(stt ? [{ id: stt.id, label: stt.label, use: "Speech-to-text", keyUrl: stt.keyUrl }] : []),
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

      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ maxWidth: 620, margin: "0 auto", padding: "24px 22px 60px" }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 22px" }}>
          You bring your own keys. They are stored in your operating system's keychain, never in a
          file, and are sent only to the provider they belong to.
        </p>

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
          {theme.pref === "system" && (
            <div style={{ fontSize: 12, color: "var(--text-faint)", paddingTop: 2 }}>
              Following your OS setting — currently {resolvedTheme(theme.pref)}.
            </div>
          )}

          <Row label="Accent">
            <div style={{ display: "flex", gap: 6 }}>
              {ACCENTS.map((a) => (
                <button
                  key={a.pref}
                  onClick={() => accent.setAccent(a.pref)}
                  title={a.label}
                  aria-label={a.label}
                  aria-pressed={accent.accent === a.pref}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 99,
                    background: a.swatch,
                    // The selected swatch gets a ring drawn in the page background
                    // so it reads against any colour, including near-white.
                    boxShadow:
                      accent.accent === a.pref
                        ? "0 0 0 2px var(--bg), 0 0 0 4px var(--text)"
                        : "none",
                  }}
                />
              ))}
            </div>
          </Row>
          <div style={{ fontSize: 12, color: "var(--text-faint)", paddingTop: 2 }}>
            Monochrome keeps the interface black and white. Any other choice tints
            selection, active state and primary buttons only.
          </div>
        </Section>

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
