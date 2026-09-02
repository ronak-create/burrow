import { useEffect, useMemo, useRef, useState } from "react";
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  searchWorkspaces,
  updateWorkspaceMeta,
  type SearchHit,
  type WorkspaceMeta,
} from "../workspace/api";
import { BurrowMark, Icon } from "../ui/icons";
import Settings from "./Settings";
import { toastError } from "../ui/toastStore";
import { GETTING_STARTED_NAME } from "../workspace/gettingStarted";

/**
 * The first screen: a flat list of workspaces sorted by last opened, filterable by
 * text. No nested folders (spec C) — a researcher's projects are a short list,
 * not a tree.
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
  const searchRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [hits, setHits] = useState<SearchHit[]>([]);
  /** The workspace awaiting a delete confirmation, if any. */
  const [confirming, setConfirming] = useState<WorkspaceMeta | null>(null);
  const [renaming, setRenaming] = useState<WorkspaceMeta | null>(null);
  const [renameTo, setRenameTo] = useState("");

  /**
   * Content search across every workspace (spec C), not just a name filter.
   *
   * Debounced because each run reads every board and transcript on disk; running
   * that per keystroke would hammer the filesystem for results the user is still
   * typing past. Failures are swallowed: search is an enhancement to the list
   * below it, and a toast on every keystroke of a failing query would be worse
   * than quietly showing nothing.
   */
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => {
      searchWorkspaces(root, q)
        .then(setHits)
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [query, root]);

  /** "/" jumps to search, unless the user is already typing somewhere. */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (typing) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

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

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = items.filter((i) => {
      if (!q) return true;
      return (
        i.name.toLowerCase().includes(q) || i.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
    // Pinned first; the backend already returns the rest by last-opened.
    return [...matched].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }, [items, query]);

  async function destroy(ws: WorkspaceMeta) {
    try {
      await deleteWorkspace(root, ws.id);
      setConfirming(null);
      await refresh();
    } catch (e) {
      toastError(e);
    }
  }

  async function rename(ws: WorkspaceMeta, name: string) {
    const next = name.trim();
    // Renaming only changes the display name; the folder id is what other things
    // reference, so it deliberately stays put.
    if (!next || next === ws.name) {
      setRenaming(null);
      return;
    }
    try {
      await updateWorkspaceMeta(root, ws.id, { name: next });
      setRenaming(null);
      await refresh();
    } catch (e) {
      toastError(e);
    }
  }

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
        <BurrowMark size={36} style={{ borderRadius: "var(--r-md)", flexShrink: 0 }} />
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
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type, or press / to search your workspaces…"
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
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
                New workspace
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

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <button
                  onClick={() => setNewPinned((v) => !v)}
                  aria-pressed={newPinned}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    color: "var(--text-muted)",
                  }}
                >
                  <span
                    // Track and knob, drawn from tokens so it follows the theme.
                    style={{
                      flexShrink: 0,
                      width: 28,
                      height: 16,
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
                        left: newPinned ? 14 : 2,
                        width: 12,
                        height: 12,
                        borderRadius: 99,
                        background: newPinned ? "var(--on-accent)" : "var(--surface)",
                        transition: "left 120ms ease",
                      }}
                    />
                  </span>
                  Pin
                </button>

                <div style={{ display: "flex", gap: 8 }}>
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
          </div>
        )}

        {hits.length > 0 && (
          <div style={{ marginBottom: 22 }}>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                marginBottom: 8,
              }}
            >
              {hits.length} match{hits.length === 1 ? "" : "es"} inside workspaces
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {hits.map((h, i) => {
                const ws = items.find((w) => w.id === h.workspaceId);
                return (
                  <button
                    key={`${h.workspaceId}-${i}`}
                    // A hit is only useful if it takes you there; without the
                    // workspace still on disk there is nothing to open.
                    onClick={() => ws && onOpen(ws)}
                    disabled={!ws}
                    style={{
                      textAlign: "left",
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--r-md)",
                      padding: "9px 12px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{h.workspaceName}</span>
                      <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
                        {h.kind === "block" ? "on the board" : "in conversation"}
                      </span>
                    </span>
                    <span
                      className="selectable"
                      style={{
                        fontSize: 12,
                        color: "var(--text-muted)",
                        lineHeight: 1.5,
                        overflowWrap: "anywhere",
                      }}
                    >
                      {h.snippet}
                    </span>
                  </button>
                );
              })}
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
              : hits.length > 0
                ? "No workspace names match, but there are matches inside — see above."
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

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenaming(ws);
                    setRenameTo(ws.name);
                  }}
                  title="Rename"
                  aria-label="Rename"
                  style={{
                    position: "absolute",
                    top: 10,
                    right: 62,
                    display: "grid",
                    placeItems: "center",
                    width: 26,
                    height: 26,
                    borderRadius: "var(--r-sm)",
                    color: "var(--text-faint)",
                  }}
                >
                  <Icon name="text" size={14} />
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirming(ws);
                  }}
                  title="Delete workspace"
                  aria-label="Delete workspace"
                  style={{
                    position: "absolute",
                    top: 10,
                    right: 36,
                    display: "grid",
                    placeItems: "center",
                    width: 26,
                    height: 26,
                    borderRadius: "var(--r-sm)",
                    color: "#e5484d",
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>

                {ws.name === GETTING_STARTED_NAME && (
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
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>
                      #
                    </span>
                  </div>
                )}
                <div style={{ fontWeight: 600, marginTop: "auto" }}>{ws.name}</div>
                <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
                  {ws.blockCount} {ws.blockCount === 1 ? "block" : "blocks"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setConfirming(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(0, 0, 0, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
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
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
              Delete “{confirming.name}”?
            </div>
            <div style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 18 }}>
              This removes the whole folder from your disk — the board, every document
              and image you imported, and the conversation transcript. It cannot be
              undone from inside Burrow.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setConfirming(null)}
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
                onClick={() => void destroy(confirming)}
                style={{
                  padding: "8px 18px",
                  borderRadius: "var(--r-sm)",
                  fontSize: 14,
                  fontWeight: 500,
                  background: "var(--danger)",
                  color: "var(--on-accent)",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {renaming && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setRenaming(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(0, 0, 0, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
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
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
              Rename workspace
            </div>
            <input
              autoFocus
              value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void rename(renaming, renameTo);
                if (e.key === "Escape") setRenaming(null);
              }}
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
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setRenaming(null)}
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
                onClick={() => void rename(renaming, renameTo)}
                disabled={!renameTo.trim()}
                style={{
                  padding: "8px 18px",
                  borderRadius: "var(--r-sm)",
                  fontSize: 14,
                  fontWeight: 500,
                  background: "var(--accent)",
                  color: "var(--on-accent)",
                  opacity: renameTo.trim() ? 1 : 0.4,
                }}
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
