import { useCallback, useRef, type CSSProperties, type ReactNode } from "react";
import { useBoard } from "../store";

/**
 * Shared chrome and editing behaviour for every block type.
 *
 * The important piece here is `useInlineEdit`. Typing must not push an undo entry
 * per keystroke, so keystrokes apply transiently and a single history entry is
 * recorded on blur, inverting back to whatever the text was when editing began.
 * One edit session = one Ctrl+Z.
 */

export function useInlineEdit(id: string, key: string) {
  const applyTransient = useBoard((s) => s.applyTransient);
  const record = useBoard((s) => s.record);
  // Value at the moment the field gained focus — the inverse for the whole session.
  const start = useRef<string | null>(null);
  const latest = useRef<string>("");

  const onFocus = useCallback(
    (e: { currentTarget: { value: string } }) => {
      start.current = e.currentTarget.value;
      latest.current = e.currentTarget.value;
    },
    [],
  );

  const onChange = useCallback(
    (e: { currentTarget: { value: string } }) => {
      latest.current = e.currentTarget.value;
      applyTransient({ t: "updateBlock", id, patch: { [key]: e.currentTarget.value } });
    },
    [applyTransient, id, key],
  );

  const onBlur = useCallback(() => {
    const before = start.current;
    start.current = null;
    if (before === null || before === latest.current) return;
    record(
      { t: "updateBlock", id, patch: { [key]: latest.current } },
      { t: "updateBlock", id, patch: { [key]: before } },
      "user",
      "edit text",
    );
  }, [record, id, key]);

  return { onFocus, onChange, onBlur };
}

/** React Flow reserves these: nodrag stops drag-to-move, nowheel allows inner scroll. */
export const NODRAG = "nodrag";
export const NOWHEEL = "nowheel";

export const cardStyle = (selected: boolean): CSSProperties => ({
  background: "var(--card)",
  border: `1px solid ${selected ? "var(--accent-line)" : "var(--border)"}`,
  borderRadius: "var(--r-lg)",
  boxShadow: selected ? "0 0 0 1px var(--accent-line), var(--shadow-card)" : "var(--shadow-card)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  width: "100%",
  height: "100%",
  transition: "border-color 120ms ease, box-shadow 120ms ease",
});

export const titleInputStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  outline: "none",
  fontWeight: 600,
  fontSize: 14,
  padding: "12px 14px 6px",
  width: "100%",
};

export const bodyStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  outline: "none",
  resize: "none",
  flex: 1,
  padding: "0 14px 14px",
  fontSize: 13,
  lineHeight: 1.55,
  color: "var(--text-muted)",
  width: "100%",
};

/**
 * The temporary "?" the assistant drops when it is unsure about a block (spec D).
 * Clicking it clears the flag — it is a prompt, not permanent state.
 */
export function MarkerPin({ id }: { id: string }) {
  const run = useBoard((s) => s.run);
  return (
    <button
      className={NODRAG}
      title="The assistant flagged this. Click to clear."
      onClick={(e) => {
        e.stopPropagation();
        run({ t: "setMarker", id, marker: null }, "user");
      }}
      style={{
        position: "absolute",
        top: -9,
        right: -9,
        width: 20,
        height: 20,
        borderRadius: 99,
        background: "var(--warn)",
        color: "#1a1205",
        fontSize: 12,
        fontWeight: 700,
        lineHeight: "20px",
        textAlign: "center",
        boxShadow: "var(--shadow-card)",
        zIndex: 5,
      }}
    >
      ?
    </button>
  );
}

export function BlockShell({
  selected,
  marker,
  id,
  children,
}: {
  selected: boolean;
  marker?: string | null;
  id: string;
  children: ReactNode;
}) {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {marker ? <MarkerPin id={id} /> : null}
      <div style={cardStyle(selected)}>{children}</div>
    </div>
  );
}
