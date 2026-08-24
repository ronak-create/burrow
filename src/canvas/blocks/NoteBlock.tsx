import { Handle, NodeResizer, Position, type NodeProps } from "@xyflow/react";
import { BlockShell, NODRAG, NOWHEEL, bodyStyle, titleInputStyle, useInlineEdit } from "./common";
import type { NoteBlock as NoteBlockType } from "../types";

/** Small, unobtrusive connection points — the "red string" between findings. */
const handleStyle = {
  width: 7,
  height: 7,
  background: "var(--accent)",
  border: "2px solid var(--bg)",
  opacity: 0,
  transition: "opacity 120ms ease",
};

export function ConnectHandles() {
  return (
    <>
      {(
        [
          [Position.Top, "top"],
          [Position.Right, "right"],
          [Position.Bottom, "bottom"],
          [Position.Left, "left"],
        ] as const
      ).map(([pos, id]) => (
        <Handle
          key={id}
          id={id}
          type="source"
          position={pos}
          style={handleStyle}
          className="block-handle"
        />
      ))}
    </>
  );
}

export default function NoteBlockView({ id, data, selected }: NodeProps<NoteBlockType>) {
  const title = useInlineEdit(id, "title");
  const body = useInlineEdit(id, "body");

  return (
    <BlockShell id={id} selected={!!selected} marker={data.marker}>
      <NodeResizer
        isVisible={!!selected}
        minWidth={180}
        minHeight={110}
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

      <input
        className={NODRAG}
        style={titleInputStyle}
        placeholder="Untitled note"
        value={data.title ?? ""}
        onFocus={title.onFocus}
        onChange={title.onChange}
        onBlur={title.onBlur}
      />
      <textarea
        className={`${NODRAG} ${NOWHEEL} selectable`}
        style={bodyStyle}
        placeholder="Start typing…"
        value={data.body ?? ""}
        onFocus={body.onFocus}
        onChange={body.onChange}
        onBlur={body.onBlur}
      />
    </BlockShell>
  );
}
