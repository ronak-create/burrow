import { useCallback, useEffect, useRef, useState } from "react";
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";

import Board from "../canvas/Board";
import AssistantPanel from "./AssistantPanel";
import Settings from "./Settings";
import { useCanvasMode, type CanvasMode } from "../canvas/ink/mode";
import { Icon, type IconName } from "../ui/icons";
import { INK_COLORS, INK_SIZES, SHAPE_STROKE_WIDTHS, inkColor } from "../canvas/ink/stroke";
import { useBoard } from "../canvas/store";
import { type BlockKind } from "../canvas/types";
import { useAutosave, saveNow } from "../workspace/persist";
import { useCurrentWorkspace } from "../workspace/current";
import DocumentViewer from "./DocumentViewer";
import DocumentsPanel from "./DocumentsPanel";
import { toastError } from "../ui/toast";
import { updateWorkspaceMeta, type WorkspaceMeta } from "../workspace/api";

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
  const past = useBoard((s) => s.past.length);
  const { zoomIn, zoomOut, fitView, getZoom } = useReactFlow();
  const [showSettings, setShowSettings] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [showPanel, setShowPanel] = useState(true);
  const [name, setName] = useState(ws.name);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(ws.name);

  async function renameWorkspace() {
    const next = nameDraft.trim();
    setEditingName(false);
    if (!next || next === name) {
      setNameDraft(name);
      return;
    }
    try {
      await updateWorkspaceMeta(root, ws.id, { name: next });
      setName(next);
    } catch (e) {
      setNameDraft(name);
      toastError(e);
    }
  }
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = Number(localStorage.getItem("burrow.assistantWidth"));
    return saved >= 260 && saved <= 640 ? saved : 340;
  });
  const splitRef = useRef<HTMLDivElement>(null);
  const resizing = useRef(false);

  const onResizerDown = (e: React.PointerEvent) => {
    resizing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onResizerMove = (e: React.PointerEvent) => {
    if (!resizing.current || !splitRef.current) return;
    const rect = splitRef.current.getBoundingClientRect();
    setPanelWidth(Math.min(640, Math.max(260, rect.right - e.clientX)));
  };
  const onResizerUp = (e: React.PointerEvent) => {
    if (!resizing.current) return;
    resizing.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    setPanelWidth((w) => {
      localStorage.setItem("burrow.assistantWidth", String(w));
      return w;
    });
  };
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
  const disarm = useCanvasMode((m) => m.disarm);
  const addBlock = useCallback(
    (kind: BlockKind, variant?: "rectangle" | "ellipse") => {
      // Clicking the armed tool again puts it away, rather than re-arming what is
      // already armed — a toggle is what a pressed-looking button implies.
      const m = useCanvasMode.getState();
      const same =
        m.mode === "place" && m.pending?.kind === kind && m.pending?.variant === variant;
      if (same) disarm();
      else arm({ kind, variant });
    },
    [arm, disarm],
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
      // Losing work silently is the worst outcome in the app, so this is the one
      // save failure the user is told about — autosave stays quiet because it
      // retries, but leaving is the last chance to write the tail of a session.
      toastError(e);
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
        {editingName ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => void renameWorkspace()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setNameDraft(name);
                setEditingName(false);
              }
            }}
            style={{
              fontWeight: 600,
              fontSize: 15,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-sm)",
              padding: "3px 6px",
              outline: "none",
              minWidth: 120,
            }}
          />
        ) : (
          <span
            onClick={() => setEditingName(true)}
            title="Click to rename"
            style={{ fontWeight: 600, fontSize: 15, cursor: "text", padding: "3px 6px" }}
          >
            {name}
          </span>
        )}

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
        <button onClick={() => setShowDocs(true)} style={iconBtn} title="Files">
          <Icon name="upload" />
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

      <div ref={splitRef} style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
          <Board />

          {mode === "draw" && <InkPalette />}
          {mode === "place" && pending?.kind === "shape" && <ShapePalette />}

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
              // An armed tool has to look armed: the click no longer produces a
              // block, so without this the toolbar gives no sign anything happened.
              const armed =
                mode === "place" &&
                pending?.kind === t.kind &&
                pending?.variant === t.variant;
              return (
                <button
                  key={`${t.kind}:${t.variant ?? ""}`}
                  onClick={() => addBlock(t.kind, t.variant)}
                  title={`${t.label} — click or drag on the canvas to draw one`}
                  style={{
                    width: 56,
                    padding: "7px 0",
                    borderRadius: "var(--r-md)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 3,
                    background: armed ? "var(--accent-wash)" : "transparent",
                    color: armed ? "var(--accent)" : "var(--text)",
                  }}
                  onMouseEnter={(e) =>
                    !armed && (e.currentTarget.style.background = "var(--card-hover)")
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

        {showPanel && (
          <>
            <div
              onPointerDown={onResizerDown}
              onPointerMove={onResizerMove}
              onPointerUp={onResizerUp}
              onPointerCancel={onResizerUp}
              style={{
                width: 5,
                flexShrink: 0,
                cursor: "col-resize",
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 2,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: "var(--border)",
                }}
              />
            </div>
            <div style={{ width: panelWidth, flexShrink: 0, minWidth: 0 }}>
              <AssistantPanel root={root} wsId={ws.id} />
            </div>
          </>
        )}
      </div>

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
      {showDocs && <DocumentsPanel onClose={() => setShowDocs(false)} />}
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

/** Colour and border thickness, shown only while a shape tool is armed. */
function ShapePalette() {
  const { color, shapeStrokeWidth, setColor, setShapeStrokeWidth } = useCanvasMode();
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

      {SHAPE_STROKE_WIDTHS.map((w) => (
        <button
          key={w}
          title={`${w}px border`}
          onClick={() => setShapeStrokeWidth(w)}
          style={{
            width: 22,
            height: 22,
            borderRadius: "var(--r-sm)",
            display: "grid",
            placeItems: "center",
            background: shapeStrokeWidth === w ? "var(--card-hover)" : "transparent",
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 3,
              border: `${w}px solid ${inkColor(color)}`,
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
