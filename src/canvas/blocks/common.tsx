import { useCallback, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { create } from "zustand";
import { useBoard } from "../store";
import { Icon } from "../../ui/icons";

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

/* ---------- block activation ---------- */

/**
 * Which block, if any, the user has drilled into.
 *
 * A block is a single object first and a set of editable fields second. Every
 * block used to render its live inputs straight onto the canvas, and because an
 * input swallows the pointer, three things followed: one click landed inside a
 * text field instead of selecting the card, the field's `nodrag` meant most of a
 * card's surface could not be dragged at all, and its `nowheel` meant the wheel
 * scrolled the field instead of zooming the board. The card looked like an object
 * and behaved like a form.
 *
 * So editing is a mode you enter deliberately, the way it works in every canvas
 * tool: one click selects the block, a double click drills into its contents.
 * Until then the contents are inert and the pointer belongs to the board — drag
 * from anywhere, zoom from anywhere. Only one block is active at a time, because
 * entering one is what leaves the last.
 */
interface ActiveBlockState {
  activeId: string | null;
  activate: (id: string) => void;
  clear: () => void;
}

export const useActiveBlock = create<ActiveBlockState>((set) => ({
  activeId: null,
  activate: (id) => set({ activeId: id }),
  clear: () => set({ activeId: null }),
}));

/**
 * Wire a block into the activation model.
 *
 * Returns the props the block's outer element must spread, plus `active`. The
 * caller wraps its interactive contents in `<BlockContents>`, which is what makes
 * them inert until drilled into.
 */
export function useActivation(id: string, selected: boolean) {
  const activeId = useActiveBlock((s) => s.activeId);
  const activate = useActiveBlock((s) => s.activate);
  const clear = useActiveBlock((s) => s.clear);
  const active = activeId === id;
  const ref = useRef<HTMLDivElement | null>(null);

  // Deselecting is leaving. Without this a block stayed drilled-in after the user
  // clicked the canvas, and the next click on it landed in a field again.
  useEffect(() => {
    if (active && !selected) clear();
  }, [active, selected, clear]);

  // Escape steps back out to having the block selected, matching every other
  // dismissable surface in the app.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clear();
        (document.activeElement as HTMLElement | null)?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, clear]);

  const onDoubleClick = useCallback(() => {
    if (active) return;
    activate(id);
    // The double click that drilled in cannot also land in a field, because the
    // field was inert when it happened. Put the caret somewhere useful instead of
    // making the user click a third time.
    requestAnimationFrame(() => {
      const el = ref.current?.querySelector<HTMLElement>(
        "input:not([disabled]), textarea:not([disabled]), [contenteditable='true']",
      );
      el?.focus();
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.select();
    });
  }, [active, activate, id]);

  return { active, ref, onDoubleClick };
}

/**
 * Makes a block's contents inert until it has been drilled into.
 *
 * `pointerEvents: none` is doing the real work. Applied to the element holding a
 * block's fields, a press on a text field is delivered instead to React Flow's
 * node wrapper underneath — which starts a drag — and a wheel event reaches the
 * pane, which zooms the board. It also renders any `nodrag` or `nowheel` inside
 * harmless while inactive, since neither element is ever the event target.
 *
 * A style rather than a wrapper component on purpose: every block's contents sit
 * in a flex layout, and an extra div between parent and children would collapse
 * it. This goes on a box that already exists.
 */
export const inertStyle = (active: boolean): CSSProperties => ({
  pointerEvents: active ? "auto" : "none",
  // Selecting text inside a block nobody has drilled into would fight the marquee.
  userSelect: active ? "auto" : "none",
});

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
  fontSize: 15,
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
  fontSize: 14,
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
        color: "var(--on-accent)",
        fontSize: 13,
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

/**
 * Delete, shown on the selected block.
 *
 * Delete and Backspace are React Flow's delete keys, but a note is almost
 * entirely text inputs — so the key lands in a field and edits text instead of
 * removing the node, and there is nowhere on the card to click that selects
 * without focusing something. Cards with less text surface were deletable and
 * notes were not, which read as notes being undeletable. An explicit control is
 * uniform across every block type and does not depend on where focus happens to
 * be.
 */
function DeleteButton({ id }: { id: string }) {
  const run = useBoard((s) => s.run);
  return (
    <button
      className={NODRAG}
      title="Delete block"
      aria-label="Delete block"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        // Through the command layer, so it lands on the shared undo stack and
        // takes the block's edges with it.
        run({ t: "removeBlock", id }, "user");
      }}
      style={{
        position: "absolute",
        top: -10,
        right: -10,
        zIndex: 6,
        display: "grid",
        placeItems: "center",
        width: 20,
        height: 20,
        borderRadius: 99,
        background: "var(--surface)",
        border: "1px solid var(--border-strong)",
        color: "var(--text-muted)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <Icon name="close" size={12} />
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
  const { active, ref, onDoubleClick } = useActivation(id, selected);

  return (
    <div
      ref={ref}
      onDoubleClick={onDoubleClick}
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
      {marker ? <MarkerPin id={id} /> : null}
      {selected ? <DeleteButton id={id} /> : null}
      {/* The pin and the delete control sit outside the card so they stay clickable
          on a block nobody has drilled into — they act on the block, not in it. */}
      <div
        style={{
          ...cardStyle(selected),
          ...inertStyle(active),
          // A drilled-in card reads as focused rather than merely selected.
          ...(active ? { borderColor: "var(--accent)" } : {}),
        }}
      >
        {children}
      </div>
    </div>
  );
}
