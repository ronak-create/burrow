import { useEffect, useMemo, useState } from "react";
import { createWorkspace, listWorkspaces, type WorkspaceMeta } from "../workspace/api";
import { Icon } from "../ui/icons";

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
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setItems(await listWorkspaces(root));
      setError(null);
    } catch (e) {
      setError(String(e));
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
    return items.filter((i) => {
      if (activeTag && !i.tags.includes(activeTag)) return false;
      if (!q) return true;
      return (
        i.name.toLowerCase().includes(q) || i.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [items, query, activeTag]);

  async function create() {
    const name = newName.trim();
    if (!name) return;
    try {
      const ws = await createWorkspace(root, name, []);
      setNewName("");
      setCreating(false);
      onOpen(ws);
    } catch (e) {
      setError(String(e));
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
            fontSize: 18,
          }}
        >
          <Icon name="logo" size={19} style={{ color: "var(--on-accent)" }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 650, letterSpacing: -0.2 }}>Burrow</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
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
            fontSize: 13,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon name="add" size={14} /> New
          </span>
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
                  fontSize: 11,
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

        {error && (
          <div
            className="selectable"
            style={{
              background: "var(--danger-wash)",
              border: "1px solid var(--danger-line)",
              color: "var(--danger)",
              borderRadius: "var(--r-md)",
              padding: "10px 14px",
              marginBottom: 16,
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {creating && (
          <div
            style={{
              background: "var(--card)",
              border: "1px solid var(--accent-line)",
              borderRadius: "var(--r-lg)",
              padding: 16,
              marginBottom: 16,
              display: "flex",
              gap: 8,
            }}
          >
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
                flex: 1,
                background: "var(--surface-2)",
                border: "1px solid var(--border)",
                borderRadius: "var(--r-sm)",
                padding: "8px 12px",
                outline: "none",
              }}
            />
            <button
              onClick={() => void create()}
              style={{
                background: "var(--accent)",
                color: "var(--on-accent)",
                padding: "8px 16px",
                borderRadius: "var(--r-sm)",
                fontSize: 13,
              }}
            >
              Create
            </button>
            <button
              onClick={() => setCreating(false)}
              style={{ color: "var(--text-muted)", padding: "8px 10px", fontSize: 13 }}
            >
              Cancel
            </button>
          </div>
        )}

        {shown.length === 0 && !creating ? (
          <div
            style={{
              textAlign: "center",
              padding: "70px 0",
              color: "var(--text-faint)",
              fontSize: 13,
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
              <button
                key={ws.id}
                onClick={() => onOpen(ws)}
                style={{
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
                  <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
                    {ws.blockCount} {ws.blockCount === 1 ? "block" : "blocks"}
                  </span>
                  {ws.tags.map((t) => (
                    <span
                      key={t}
                      style={{
                        fontSize: 10,
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
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
