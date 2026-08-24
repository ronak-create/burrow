import { NodeResizer, type NodeProps } from "@xyflow/react";
import { MarkerPin, NODRAG, NOWHEEL, useInlineEdit } from "./common";
import { ConnectHandles } from "./NoteBlock";
import { inkColor } from "../ink/stroke";
import type { TextBlock as TextBlockType } from "../types";

/**
 * Loose text with no card around it — headings, labels, a scribbled question.
 * Deliberately chrome-less: a note already exists for anything that wants a
 * container, and the difference between the two is the whole point.
 */
export default function TextBlockView({ id, data, selected }: NodeProps<TextBlockType>) {
  const text = useInlineEdit(id, "text");

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {data.marker ? <MarkerPin id={id} /> : null}

      <NodeResizer
        isVisible={!!selected}
        minWidth={60}
        minHeight={28}
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

      <textarea
        className={`${NODRAG} ${NOWHEEL} selectable`}
        value={data.text ?? ""}
        onFocus={text.onFocus}
        onChange={text.onChange}
        onBlur={text.onBlur}
        placeholder="Text"
        style={{
          width: "100%",
          height: "100%",
          background: "transparent",
          // Only the selection ring, never a card — this must not read as a note.
          border: selected ? "1px solid var(--accent-line)" : "1px solid transparent",
          borderRadius: "var(--r-sm)",
          outline: "none",
          resize: "none",
          padding: "4px 6px",
          fontSize: data.size ?? 18,
          fontWeight: 550,
          lineHeight: 1.3,
          color: data.color ? inkColor(data.color) : "var(--text)",
        }}
      />
    </div>
  );
}
