import { useEffect, useMemo, useState } from "react";
import {
  createWorkspace,
  listWorkspaces,
  updateWorkspaceMeta,
  type WorkspaceMeta,
} from "../workspace/api";
import { Icon } from "../ui/icons";
import Settings from "./Settings";
import { toastError } from "../ui/toast";

/**
 * The first screen: a flat list of workspaces sorted by last opened, filterable by
 * text or tag. No nested folders (spec C) — a researcher's projects are a short
 * list, not a tree, and tags cover the grouping people actually want.
 */
export default function WorkspaceBrowser({
  root,
  onOpen,
}: {
  root: string;
  onOpen: (ws: WorkspaceMeta) => void;
}) {
  const [items, setItems] = useState<WorkspaceMeta[]>([]);
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPinned, setNewPinned] = useState(false);

  const refresh = async () => {
    try {
      setItems(await listWorkspaces(root));
    } catch (e) {
      toastError(e);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  const allTags = useMemo(
    () => [...new Set(items.flatMap((i) => i.tags))].sort(),
    [items],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = items.filter((i) => {
      if (activeTag && !i.tags.includes(activeTag)) return false;
      if (!q) return true;
      return (
        i.name.toLowerCase().includes(q) || i.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
    // Pinned first; the backend already returns the rest by last-opened.
    return [...matched].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }, [items, query, activeTag]);

  async function togglePin(ws: WorkspaceMeta) {
    // Update on disk first, then re-list, so the order shown always matches the
    // order that would survive a restart.
    try {
      await updateWorkspaceMeta(root, ws.id, { pinned: !ws.pinned });
      await refresh();
    } catch (e) {
      toastError(e);
    }
  }

  async function create() {
    const name = newName.trim();
    if (!name) return;
    try {
      const ws = await createWorkspace(root, name, [], newPinned);
      setNewName("");
      setNewPinned(false);
      setCreating(false);
      onOpen(ws);
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <div style={{ height: "100%", overflowY: "auto" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "22px 32px",
          maxWidth: 1000,
          margin: "0 auto",
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "var(--r-md)",
            background: "var(--accent)",
            display: "grid",
            placeItems: "center",
            fontSize: 19,
          }}
        >
          <Icon name="logo" size={19} style={{ color: "var(--on-accent)" }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Burrow</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Dig until you hit the root of it
          </div>
        </div>
        <button
          onClick={() => setCreating(true)}
          style={{
            background: "var(--accent)",
            color: "var(--on-accent)",
            padding: "8px 16px",
            borderRadius: "var(--r-md)",
            fontWeight: 500,
            fontSize: 14,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon name="add" size={14} /> New
          </span>
        </button>
        <button
          onClick={() => setShowSettings(true)}
          title="Settings"
          aria-label="Settings"
          style={{
            display: "grid",
            placeItems: "center",
            width: 34,
            height: 34,
            marginLeft: 4,
            borderRadius: "var(--r-md)",
            background: "transparent",
            color: "var(--text-muted)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
        >
          <Icon name="settings" size={18} />
        </button>
      </header>

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "0 32px 40px" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search workspaces and tags…"
          style={{
            width: "100%",
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: "var(--r-md)",
            padding: "10px 14px",
            outline: "none",
            marginBottom: 14,
          }}
        />

        {allTags.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
            {allTags.map((t) => (
              <button
                key={t}
                onClick={() => setActiveTag(activeTag === t ? null : t)}
                style={{
                  fontSize: 12,
                  padding: "3px 9px",
                  borderRadius: 99,
                  border: `1px solid ${activeTag === t ? "var(--accent-line)" : "var(--border)"}`,
                  background: activeTag === t ? "var(--accent-wash)" : "transparent",
                  color: activeTag === t ? "var(--accent)" : "var(--text-muted)",
                }}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {creating && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="New workspace"
            onClick={() => setCreating(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 50,
              background: "rgba(0, 0, 0, 0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
            }}
          >
            <div
              // The backdrop closes on click, so clicks inside the card must not
              // bubble up to it.
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%",
                maxWidth: 440,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--r-lg)",
                boxShadow: "var(--shadow-pop)",
                padding: 20,
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                New workspace
              </div>
              <div style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 16 }}>
                A folder on your disk holding this project's board, documents and
                transcript.
              </div>

              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void create();
                  if (e.key === "Escape") setCreating(false);
                }}
                placeholder="Workspace name, e.g. Redis Deep Dive"
                style={{
                  width: "100%",
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--r-sm)",
                  padding: "9px 12px",
                  outline: "none",
                  marginBottom: 18,
                }}
              />

              <button
                onClick={() => setNewPinned((v) => !v)}
                aria-pressed={newPinned}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  padding: "9px 12px",
                  marginBottom: 18,
                  borderRadius: "var(--r-sm)",
                  border: `1px solid ${newPinned ? "var(--accent-line)" : "var(--border)"}`,
                  background: newPinned ? "var(--accent-wash)" : "transparent",
                  textAlign: "left",
                }}
              >
                <span
                  // Track and knob, drawn from tokens so it follows the theme.
                  style={{
                    flexShrink: 0,
                    width: 32,
                    height: 18,
                    borderRadius: 99,
                    background: newPinned ? "var(--accent)" : "var(--border-strong)",
                    position: "relative",
                    transition: "background 120ms ease",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 2,
                      left: newPinned ? 16 : 2,
                      width: 14,
                      height: 14,
                      borderRadius: 99,
                      background: newPinned ? "var(--on-accent)" : "var(--surface)",
                      transition: "left 120ms ease",
                    }}
                  />
                </span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: "block", fontSize: 14 }}>Pin this workspace</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)" }}>
                    Keeps it at the top of the list.
                  </span>
                </span>
              </button>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  onClick={() => setCreating(false)}
                  style={{
                    color: "var(--text-muted)",
                    padding: "8px 14px",
                    borderRadius: "var(--r-sm)",
                    fontSize: 14,
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => void create()}
                  disabled={!newName.trim()}
                  style={{
                    background: "var(--accent)",
                    color: "var(--on-accent)",
                    padding: "8px 18px",
                    borderRadius: "var(--r-sm)",
                    fontSize: 14,
                    fontWeight: 500,
                    opacity: newName.trim() ? 1 : 0.4,
                    cursor: newName.trim() ? "pointer" : "not-allowed",
                  }}
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}

        {shown.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "70px 0",
              color: "var(--text-faint)",
              fontSize: 14,
            }}
          >
            {items.length === 0
              ? "No workspaces yet. Create one to start a board."
              : "Nothing matches that filter."}
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
              gap: 14,
            }}
          >
            {shown.map((ws) => (
              <div
                key={ws.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(ws)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(ws);
                  }
                }}
                style={{
                  position: "relative",
                  cursor: "pointer",
                  textAlign: "left",
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--r-lg)",
                  padding: 16,
                  minHeight: 132,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  transition: "background 120ms ease, border-color 120ms ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--card-hover)";
                  e.currentTarget.style.borderColor = "var(--border-strong)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--card)";
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void togglePin(ws);
                  }}
                  title={ws.pinned ? "Unpin" : "Pin to top"}
                  aria-label={ws.pinned ? "Unpin" : "Pin to top"}
                  style={{
                    position: "absolute",
                    top: 10,
                    right: 10,
                    display: "grid",
                    placeItems: "center",
                    width: 26,
                    height: 26,
                    borderRadius: "var(--r-sm)",
                    color: ws.pinned ? "var(--accent)" : "var(--text-faint)",
                  }}
                >
                  <Icon name={ws.pinned ? "pin" : "pinOff"} size={14} />
                </button>

                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "var(--r-sm)",
                    background: "var(--accent-wash)",
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 99,
                      background: "var(--accent)",
                      display: "block",
                    }}
                  />
                </div>
                <div style={{ fontWeight: 600, marginTop: "auto" }}>{ws.name}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
                    {ws.blockCount} {ws.blockCount === 1 ? "block" : "blocks"}
                  </span>
                  {ws.tags.map((t) => (
                    <span
                      key={t}
                      style={{
                        fontSize: 11,
                        padding: "2px 7px",
                        borderRadius: 4,
                        background: "var(--surface-2)",
                        color: "var(--text-muted)",
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
