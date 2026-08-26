import { useCallback, useEffect, useState } from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";

import Board from "../canvas/Board";
import AssistantPanel from "./AssistantPanel";
import Settings from "./Settings";
import { useCanvasMode, type CanvasMode } from "../canvas/ink/mode";
import { Icon, type IconName } from "../ui/icons";
import { INK_COLORS, INK_SIZES, inkColor } from "../canvas/ink/stroke";
import { useBoard } from "../canvas/store";
import { type BlockKind } from "../canvas/types";
import { useAutosave, saveNow } from "../workspace/persist";
import { useCurrentWorkspace } from "../workspace/current";
import DocumentViewer from "./DocumentViewer";
import type { WorkspaceMeta } from "../workspace/api";

/** Every block kind the toolbar can draw. */
const ENABLED: BlockKind[] = [
  "note",
  "text",
  "shape",
  "frame",
  "table",
  "diagram",
  "doc",
  "image",
];

/** Which shape variant the toolbar's shape buttons create. */
type ToolSpec = { kind: BlockKind; label: string; icon: IconName; variant?: "rectangle" | "ellipse" };

const MODES: Array<{ mode: CanvasMode; label: string; icon: IconName; title: string }> = [
  { mode: "select", label: "Select", icon: "select", title: "Select and move blocks (V)" },
  { mode: "draw", label: "Draw", icon: "draw", title: "Draw freehand — the red string (D)" },
  { mode: "erase", label: "Erase", icon: "erase", title: "Erase strokes (E)" },
];

const TOOLS: ToolSpec[] = [
  { kind: "note", label: "Note", icon: "note" },
  { kind: "text", label: "Text", icon: "text" },
  { kind: "shape", label: "Box", icon: "rectangle", variant: "rectangle" },
  { kind: "shape", label: "Oval", icon: "ellipse", variant: "ellipse" },
  { kind: "frame", label: "Frame", icon: "frame" },
  { kind: "table", label: "Table", icon: "table" },
  { kind: "diagram", label: "Diagram", icon: "diagram" },
  { kind: "doc", label: "Doc", icon: "doc" },
  { kind: "image", label: "Image", icon: "image" },
];

function CanvasInner({ ws, root, onBack }: { ws: WorkspaceMeta; root: string; onBack: () => void }) {
  const undo = useBoard((s) => s.undo);
  const redo = useBoard((s) => s.redo);
  const dirty = useBoard((s) => s.dirty);
  const past = useBoard((s) => s.past.length);
  const { zoomIn, zoomOut, fitView, getZoom } = useReactFlow();
  const [showSettings, setShowSettings] = useState(false);
  const [showPanel, setShowPanel] = useState(true);
  const mode = useCanvasMode((s) => s.mode);
  const setMode = useCanvasMode((s) => s.setMode);
  const pending = useCanvasMode((s) => s.pending);

  useAutosave(root, ws.id);

  // Publish the open workspace so doc and image blocks can resolve their files.
  const setCurrent = useCurrentWorkspace((s) => s.set);
  const clearCurrent = useCurrentWorkspace((s) => s.clear);
  useEffect(() => {
    setCurrent(root, ws.id);
    return clearCurrent;
  }, [root, ws.id, setCurrent, clearCurrent]);

  /**
   * Arm a tool. Nothing is created here — PlaceLayer creates the block where the
   * user actually clicks or drags, which is the only place they can have meant.
   */
  const arm = useCanvasMode((m) => m.arm);
  const addBlock = useCallback(
    (kind: BlockKind, variant?: "rectangle" | "ellipse") => arm({ kind, variant }),
    [arm],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never hijack keys while the user is typing into a block or the assistant.
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod) {
        if (e.key.toLowerCase() === "z") {
          e.preventDefault();
          e.shiftKey ? redo() : undo();
        } else if (e.key.toLowerCase() === "y") {
          e.preventDefault();
          redo();
        }
        return;
      }

      // Single-key tool switching, the convention every drawing tool uses.
      if (e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "v") setMode("select");
      else if (key === "d") setMode("draw");
      else if (key === "e") setMode("erase");
      else if (key === "escape") setMode("select");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, setMode]);

  const back = async () => {
    try {
      await saveNow(root, ws.id);
    } catch (e) {
      console.error("save on exit failed", e);
    }
    onBack();
  };

  const iconBtn = {
    width: 28,
    height: 28,
    borderRadius: "var(--r-sm)",
    display: "grid",
    placeItems: "center",
    color: "var(--text-muted)",
    fontSize: 15,
  } as const;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <header
        style={{
          height: 46,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 14px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        <button onClick={() => void back()} style={iconBtn} title="Back to workspaces">
          <Icon name="back" />
        </button>
        <span style={{ fontWeight: 600, fontSize: 15 }}>{ws.name}</span>
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

        <span
          title={dirty ? "Unsaved changes" : "Saved"}
          style={{
            width: 6,
            height: 6,
            borderRadius: 99,
            marginLeft: 4,
            background: dirty ? "var(--warn)" : "var(--ok)",
            opacity: 0.8,
          }}
        />

        <div style={{ flex: 1 }} />

        <button onClick={undo} disabled={past === 0} style={{ ...iconBtn, opacity: past ? 1 : 0.35 }} title="Undo (Ctrl+Z)">
          <Icon name="undo" />
        </button>
        <button onClick={() => zoomOut()} style={iconBtn} title="Zoom out">
          <Icon name="zoomOut" />
        </button>
        <span style={{ fontSize: 12, color: "var(--text-muted)", width: 38, textAlign: "center" }}>
          {Math.round(getZoom() * 100)}%
        </span>
        <button onClick={() => zoomIn()} style={iconBtn} title="Zoom in">
          <Icon name="zoomIn" />
        </button>
        <button onClick={() => fitView({ padding: 0.2 })} style={iconBtn} title="Fit to content">
          <Icon name="fit" />
        </button>
        <button onClick={() => setShowSettings(true)} style={iconBtn} title="Settings">
          <Icon name="settings" />
        </button>
        <button
          onClick={() => setShowPanel((v) => !v)}
          style={{ ...iconBtn, color: showPanel ? "var(--accent)" : "var(--text-muted)" }}
          title={showPanel ? "Hide assistant" : "Show assistant"}
        >
          <Icon name="panel" />
        </button>
      </header>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
          <Board />

          {mode === "draw" && <InkPalette />}

          <div
            style={{
              position: "absolute",
              bottom: 22,
              left: "50%",
              transform: "translateX(-50%)",
              display: "flex",
              alignItems: "center",
              gap: 2,
              padding: 6,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-lg)",
              boxShadow: "var(--shadow-pop)",
            }}
          >
            {MODES.map((m) => (
              <button
                key={m.mode}
                onClick={() => setMode(m.mode)}
                title={m.title}
                style={{
                  width: 40,
                  padding: "7px 0",
                  borderRadius: "var(--r-md)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 3,
                  background: mode === m.mode ? "var(--accent-wash)" : "transparent",
                  color: mode === m.mode ? "var(--accent)" : "var(--text-muted)",
                }}
              >
                <Icon name={m.icon} size={17} />
                <span style={{ fontSize: 10 }}>{m.label}</span>
              </button>
            ))}

            <span style={{ width: 1, alignSelf: "stretch", background: "var(--border)", margin: "0 5px" }} />

            {TOOLS.map((t) => {
              const on = ENABLED.includes(t.kind);
              // An armed tool has to look armed: the click no longer produces a
              // block, so without this the toolbar gives no sign anything happened.
              const armed =
                mode === "place" &&
                pending?.kind === t.kind &&
                pending?.variant === t.variant;
              return (
                <button
                  key={`${t.kind}:${t.variant ?? ""}`}
                  disabled={!on}
                  onClick={() => addBlock(t.kind, t.variant)}
                  title={
                    on
                      ? `${t.label} — click or drag on the canvas to draw one`
                      : `${t.label} — coming in a later milestone`
                  }
                  style={{
                    width: 56,
                    padding: "7px 0",
                    borderRadius: "var(--r-md)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 3,
                    background: armed ? "var(--accent-wash)" : "transparent",
                    color: armed ? "var(--accent)" : on ? "var(--text)" : "var(--text-faint)",
                    cursor: on ? "pointer" : "not-allowed",
                    opacity: on ? 1 : 0.45,
                  }}
                  onMouseEnter={(e) =>
                    on && !armed && (e.currentTarget.style.background = "var(--card-hover)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = armed ? "var(--accent-wash)" : "transparent")
                  }
                >
                  <Icon name={t.icon} size={17} />
                  <span style={{ fontSize: 11 }}>{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {showPanel && <AssistantPanel root={root} wsId={ws.id} />}
      </div>

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      <DocumentViewer />
    </div>
  );
}

/** Colour and nib size, shown only while the pen is out. */
function InkPalette() {
  const { color, size, setColor, setSize } = useCanvasMode();
  return (
    <div
      style={{
        position: "absolute",
        bottom: 88,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 12px",
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: 99,
        boxShadow: "var(--shadow-pop)",
      }}
    >
      {INK_COLORS.map((c) => (
        <button
          key={c.key}
          title={c.label}
          onClick={() => setColor(c.key)}
          style={{
            width: 18,
            height: 18,
            borderRadius: 99,
            background: c.value,
            outline: color === c.key ? "2px solid var(--text)" : "none",
            outlineOffset: 2,
          }}
        />
      ))}

      <span style={{ width: 1, height: 18, background: "var(--border)" }} />

      {INK_SIZES.map((s) => (
        <button
          key={s}
          title={`${s}px nib`}
          onClick={() => setSize(s)}
          style={{
            width: 22,
            height: 22,
            borderRadius: 99,
            display: "grid",
            placeItems: "center",
            background: size === s ? "var(--card-hover)" : "transparent",
          }}
        >
          <span
            style={{
              width: s + 2,
              height: s + 2,
              borderRadius: 99,
              background: inkColor(color),
              display: "block",
            }}
          />
        </button>
      ))}
    </div>
  );
}

export default function CanvasScreen(props: {
  ws: WorkspaceMeta;
  root: string;
  onBack: () => void;
}) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
