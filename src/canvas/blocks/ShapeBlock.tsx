import { NodeResizer, type NodeProps } from "@xyflow/react";
import { MarkerPin, NODRAG, useInlineEdit } from "./common";
import { ConnectHandles } from "./NoteBlock";
import { inkColor } from "../ink/stroke";
import type { ShapeBlock as ShapeBlockType } from "../types";

/**
 * Rectangle and ellipse — the plain geometry of a drawing toolbox.
 *
 * These are blocks rather than ink objects so they get selection, resizing,
 * connections and undo from machinery that already exists. Outline-only by
 * default, because on a research board a shape is usually an annotation drawn
 * around something rather than an object in its own right.
 */
export default function ShapeBlockView({ id, data, selected }: NodeProps<ShapeBlockType>) {
  const label = useInlineEdit(id, "label");
  const stroke = inkColor(data.color ?? "slate");
  const round = data.variant === "ellipse" ? "50%" : "var(--r-md)";

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {data.marker ? <MarkerPin id={id} /> : null}

      <NodeResizer
        isVisible={!!selected}
        minWidth={40}
        minHeight={40}
        lineStyle={{ borderColor: "var(--accent-line)" }}
        handleStyle={{
          width: 7,
          height: 7,
          borderRadius: 2,
          background: "var(--accent)",
          border: "1px solid var(--bg)",
        }}
      />
      <ConnectHandles />

      <div
        style={{
          width: "100%",
          height: "100%",
          border: `2px solid ${stroke}`,
          borderRadius: round,
          // A filled shape uses the stroke colour at low alpha rather than a second
          // colour setting, so one palette choice covers both.
          background: data.filled ? `color-mix(in srgb, ${stroke} 18%, transparent)` : "transparent",
          boxShadow: selected ? "0 0 0 1px var(--accent-line)" : "none",
          display: "grid",
          placeItems: "center",
          padding: 10,
        }}
      >
        <input
          className={NODRAG}
          value={data.label ?? ""}
          onFocus={label.onFocus}
          onChange={label.onChange}
          onBlur={label.onBlur}
          placeholder=""
          style={{
            background: "transparent",
            border: "none",
            outline: "none",
            textAlign: "center",
            width: "100%",
            fontSize: 14,
            color: "var(--text)",
          }}
        />
      </div>
    </div>
  );
}
