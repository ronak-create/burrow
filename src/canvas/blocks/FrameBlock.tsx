import { NodeResizer, type NodeProps } from "@xyflow/react";
import { MarkerPin, NODRAG, inertStyle, useActivation, useInlineEdit } from "./common";
import type { FrameBlock as FrameBlockType } from "../types";

/**
 * A frame groups a cluster of related blocks visually. It does not own them —
 * containment is geometric (see blocksInFrame), so nothing is forced into a
 * hierarchy and any block can be dragged straight out (spec C).
 *
 * Rendered behind everything else, and only its label bar is draggable, so
 * click-and-drag inside a frame does a selection marquee rather than shoving the
 * whole group around by accident.
 */
export default function FrameBlockView({ id, data, selected }: NodeProps<FrameBlockType>) {
  const label = useInlineEdit(id, "label");
  const { active, ref, onDoubleClick } = useActivation(id, !!selected);

  return (
    <div
      ref={ref}
      onDoubleClick={onDoubleClick}
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
      {data.marker ? <MarkerPin id={id} /> : null}

      <NodeResizer
        isVisible={!!selected}
        minWidth={240}
        minHeight={180}
        lineStyle={{ borderColor: "var(--accent-line)" }}
        handleStyle={{
          width: 7,
          height: 7,
          borderRadius: 2,
          background: "var(--accent)",
          border: "1px solid var(--bg)",
        }}
      />

      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "var(--r-lg)",
          border: `1px dashed ${selected ? "var(--accent-line)" : "var(--border-strong)"}`,
          // Faint enough to read as a backdrop; a frame should never compete with
          // the blocks sitting on it.
          background: "var(--frame-wash)",
          pointerEvents: "none",
        }}
      />

      {/* The label bar is the drag handle for the whole frame — which is why it
          stays inert until the frame is drilled into. Renaming is rare; dragging a
          frame by its only visible handle is not. */}
      <input
        className="frame-label"
        style={{
          ...inertStyle(active),
          position: "absolute",
          top: 8,
          left: 10,
          background: "transparent",
          border: "none",
          outline: "none",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--accent)",
          width: "calc(100% - 20px)",
          cursor: "grab",
        }}
        placeholder="Frame label"
        value={data.label ?? ""}
        onFocus={label.onFocus}
        onChange={label.onChange}
        onBlur={label.onBlur}
        // Typing must not drag the frame; the surrounding bar still can.
        onPointerDown={(e) => e.currentTarget.classList.add(NODRAG)}
        onPointerUp={(e) => e.currentTarget.classList.remove(NODRAG)}
      />
    </div>
  );
}
