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
import { resolvedTheme, useTheme, type ThemePref } from "../ui/theme";

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
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void providers.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(id: string) {
    const key = (drafts[id] ?? "").trim();
    if (!key) return;
    setSaving(id);
    setError(null);
    try {
      await setApiKey(id, key);
      setDrafts((d) => ({ ...d, [id]: "" }));
      await providers.refresh();
    } catch (e) {
      setError(String(e));
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
      setError(String(e));
    } finally {
      setSaving(null);
    }
  }

  const keyRows = [
    ...LLM_PROVIDERS.map((p) => ({ id: p.id, label: p.label, use: "Reasoning", keyUrl: p.keyUrl })),
    ...STT_PROVIDERS.map((p) => ({ id: p.id, label: p.label, use: "Speech-to-text", keyUrl: p.keyUrl })),
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
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxHeight: "82vh",
          overflowY: "auto",
          background: "var(--surface)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--r-xl)",
          boxShadow: "var(--shadow-pop)",
          padding: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
          <h2 style={{ fontSize: 16, margin: 0, flex: 1 }}>Settings</h2>
          <button onClick={onClose} style={{ color: "var(--text-muted)", display: "grid", placeItems: "center" }} title="Close">
            <Icon name="close" size={18} />
          </button>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 20px" }}>
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
                    fontSize: 12,
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
            <div style={{ fontSize: 11, color: "var(--text-faint)", paddingTop: 2 }}>
              Following your OS setting — currently {resolvedTheme(theme.pref)}.
            </div>
          )}
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
              <span style={{ fontSize: 13, color: c.on ? "var(--text)" : "var(--text-muted)" }}>
                {c.label}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-faint)", marginLeft: "auto" }}>
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
                  ...(next?.models[0] ? { llmModel: next.models[0].id } : {}),
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
          <Row label="Model">
            <select
              value={providers.settings.llmModel}
              onChange={(e) => providers.update({ llmModel: e.target.value })}
              style={selectStyle}
            >
              {(LLM_PROVIDERS.find((p) => p.id === providers.settings.llmProvider)?.models ?? []).map(
                (m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ),
              )}
            </select>
          </Row>
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
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{row.label}</span>
                  <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{row.use}</span>
                  {configured && (
                    <span style={{ fontSize: 11, color: "var(--ok)", marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4 }}>
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
                      fontSize: 12,
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                  <button
                    disabled={!drafts[row.id]?.trim() || saving === row.id}
                    onClick={() => void save(row.id)}
                    style={{
                      padding: "0 12px",
                      borderRadius: "var(--r-sm)",
                      fontSize: 12,
                      background: drafts[row.id]?.trim() ? "var(--accent)" : "var(--surface-2)",
                      color: drafts[row.id]?.trim() ? "var(--on-accent)" : "var(--text-faint)",
                    }}
                  >
                    Save
                  </button>
                  {configured && (
                    <button
                      onClick={() => void remove(row.id)}
                      style={{ padding: "0 10px", fontSize: 12, color: "var(--danger)" }}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <a
                  href={row.keyUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 10, color: "var(--text-faint)", textDecoration: "none" }}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                    Get a key <Icon name="external" size={10} />
                  </span>
                </a>
              </div>
            );
          })}
        </Section>

        {error && (
          <div className="selectable" style={{ color: "var(--danger)", fontSize: 12, marginTop: 12 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  borderRadius: "var(--r-sm)",
  padding: "5px 9px",
  fontSize: 12,
  outline: "none",
  minWidth: 200,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 0.6,
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
      <span style={{ fontSize: 13, flex: 1 }}>{label}</span>
      {children}
    </div>
  );
}
