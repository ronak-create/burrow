import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useMenu } from "./menuStore";

/**
 * The window's own title bar, since the OS one is switched off.
 *
 * With `decorations: false` the window has no frame, which makes this strip the
 * only thing that can move it and the only way out of the app. So it carries
 * three jobs that normally belong to the system — a drag region, the
 * minimise/maximise/close controls, and the menus.
 *
 * Items resolve against whatever screen registered itself in menuStore. Nothing
 * here is a placeholder: an item either does something today or is not listed,
 * and one that needs an open board greys out on the workspace list rather than
 * failing when it is picked.
 */

interface Item {
  label: string;
  shortcut?: string;
  run?: () => void;
  /** Shown with a tick when true. */
  checked?: boolean;
  separatorBefore?: boolean;
}

const BAR_HEIGHT = 32;

function useWindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const w = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    const sync = () => void w.isMaximized().then(setMaximized).catch(() => {});
    sync();
    // The button has to follow the window, not only its own clicks: a double
    // click on the drag region maximises too, and so does the OS snap gesture.
    void w
      .onResized(sync)
      .then((f) => (unlisten = f))
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  return {
    maximized,
    minimize: () => void getCurrentWindow().minimize(),
    toggleMaximize: () => void getCurrentWindow().toggleMaximize(),
    close: () => void getCurrentWindow().close(),
  };
}

export default function MenuBar() {
  const canvas = useMenu((s) => s.canvas);
  const browser = useMenu((s) => s.browser);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const { maximized, minimize, toggleMaximize, close } = useWindowControls();

  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  const menus: Record<string, Item[]> = {
    File: [
      { label: "New workspace", run: browser?.newWorkspace },
      // Export needs an open board; import needs the list it will appear in. So
      // exactly one of the two is live on either screen, which is honest but
      // means neither is ever in the same place twice — worth revisiting if it
      // reads as flicker rather than as context.
      { label: "Import project…", run: browser?.importProject, separatorBefore: true },
      { label: "Export project…", run: canvas?.exportProject },
      { label: "Close workspace", run: canvas?.closeWorkspace, separatorBefore: true },
      { label: "Settings", run: canvas?.openSettings ?? browser?.openSettings },
      { label: "Exit", run: close, separatorBefore: true },
    ],
    Edit: [
      { label: "Undo", shortcut: "Ctrl+Z", run: canvas?.canUndo ? canvas.undo : undefined },
      {
        label: "Redo",
        shortcut: "Ctrl+Shift+Z",
        run: canvas?.canRedo ? canvas.redo : undefined,
      },
      { label: "Files", run: canvas?.openFiles, separatorBefore: true },
    ],
    View: [
      { label: "Zoom in", run: canvas?.zoomIn },
      { label: "Zoom out", run: canvas?.zoomOut },
      { label: "Fit to content", run: canvas?.fitView },
      {
        label: "Assistant",
        run: canvas?.toggleAssistant,
        checked: canvas?.assistantVisible,
        separatorBefore: true,
      },
      {
        label: maximized ? "Restore window" : "Maximise window",
        run: toggleMaximize,
        separatorBefore: true,
      },
    ],
  };

  return (
    <div
      ref={barRef}
      data-tauri-drag-region
      style={{
        height: BAR_HEIGHT,
        flexShrink: 0,
        display: "flex",
        alignItems: "stretch",
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        position: "relative",
        zIndex: 60,
      }}
    >
      {Object.keys(menus).map((name) => (
        <div key={name} style={{ position: "relative" }}>
          <button
            onClick={() => setOpenMenu(openMenu === name ? null : name)}
            // Once one menu is open the bar behaves like a menu bar rather than a
            // row of buttons: sliding sideways switches menus without a click.
            onMouseEnter={() => openMenu && setOpenMenu(name)}
            style={{
              height: "100%",
              padding: "0 10px",
              fontSize: 13,
              color: openMenu === name ? "var(--text)" : "var(--text-muted)",
              background: openMenu === name ? "var(--accent-wash)" : "transparent",
            }}
          >
            {name}
          </button>
          {openMenu === name && (
            <Dropdown items={menus[name]} onPick={() => setOpenMenu(null)} />
          )}
        </div>
      ))}

      {/* Everything between the menus and the controls drags the window. */}
      <div data-tauri-drag-region style={{ flex: 1 }} />

      <span
        style={{
          alignSelf: "center",
          fontSize: 12,
          color: "var(--text-faint)",
          paddingRight: 10,
          // Not a drag region itself, but it must not swallow the drag either.
          pointerEvents: "none",
        }}
      >
        Burrow
      </span>

      <Control onClick={minimize} label="Minimise">
        <line x1="0" y1="5.5" x2="10" y2="5.5" />
      </Control>
      <Control onClick={toggleMaximize} label={maximized ? "Restore" : "Maximise"}>
        {maximized ? (
          <>
            <rect x="0.5" y="2.5" width="7" height="7" />
            <polyline points="2.5,2.5 2.5,0.5 9.5,0.5 9.5,7.5 7.5,7.5" />
          </>
        ) : (
          <rect x="0.5" y="0.5" width="9" height="9" />
        )}
      </Control>
      <Control onClick={close} label="Close" danger>
        <line x1="0.5" y1="0.5" x2="9.5" y2="9.5" />
        <line x1="9.5" y1="0.5" x2="0.5" y2="9.5" />
      </Control>
    </div>
  );
}

function Dropdown({ items, onPick }: { items: Item[]; onPick: () => void }) {
  return (
    <div
      role="menu"
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        minWidth: 210,
        padding: 4,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--r-md)",
        boxShadow: "var(--shadow-pop)",
        zIndex: 70,
      }}
    >
      {items.map((it) => {
        const enabled = Boolean(it.run);
        return (
          <div key={it.label}>
            {it.separatorBefore && (
              <div style={{ height: 1, background: "var(--border)", margin: "4px 6px" }} />
            )}
            <button
              role="menuitem"
              disabled={!enabled}
              onClick={() => {
                it.run?.();
                onPick();
              }}
              onMouseEnter={(e) => {
                if (enabled) e.currentTarget.style.background = "var(--accent-wash)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                width: "100%",
                padding: "5px 8px",
                borderRadius: "var(--r-sm)",
                fontSize: 13,
                textAlign: "left",
                background: "transparent",
                // A greyed item still says what it would do, which is how you
                // find out an action needs a board open.
                color: enabled ? "var(--text)" : "var(--text-faint)",
                cursor: enabled ? "pointer" : "default",
              }}
            >
              <span style={{ width: 12, flexShrink: 0 }}>{it.checked ? "✓" : ""}</span>
              <span style={{ flex: 1 }}>{it.label}</span>
              {it.shortcut && (
                <span style={{ fontSize: 12, color: "var(--text-faint)" }}>{it.shortcut}</span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function Control({
  onClick,
  label,
  danger,
  children,
}: {
  onClick: () => void;
  label: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? "var(--danger-wash)" : "var(--accent-wash)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
      style={{
        width: 44,
        display: "grid",
        placeItems: "center",
        background: "transparent",
        color: "var(--text-muted)",
      }}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        shapeRendering="crispEdges"
      >
        {children}
      </svg>
    </button>
  );
}
