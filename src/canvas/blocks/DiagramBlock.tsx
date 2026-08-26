import { NodeResizer, type NodeProps } from "@xyflow/react";
import { useMemo } from "react";
import { BlockShell, NODRAG, titleInputStyle, useInlineEdit } from "./common";
import { ConnectHandles } from "./NoteBlock";
import type { DiagramData, DiagramBlock as DiagramBlockType } from "../types";

/**
 * An architecture diagram rendered inside one card.
 *
 * Per the type's contract, layout is derived and never stored: the agent emits
 * {nodes, edges} declaratively and this decides where things go. That keeps the
 * board file small and, more importantly, keeps the agent's job to describing
 * structure rather than doing arithmetic about pixels — which models are bad at
 * and which would be wrong the moment the card is resized.
 */

const NODE_W = 108;
const NODE_H = 34;
const GAP_X = 46;
const GAP_Y = 16;

interface Placed {
  id: string;
  label: string;
  x: number;
  y: number;
}

/**
 * Longest-path layering: a node sits one column right of its deepest predecessor.
 *
 * Cycles are expected — a research diagram is drawn by hand and often loops — so
 * depth resolution is iterative with a bounded pass count rather than a
 * topological sort, which would simply fail on a cycle.
 */
function layout(nodes: DiagramData["nodes"], edges: DiagramData["edges"]) {
  const ids = nodes.map((n) => n.id);
  const depth = new Map<string, number>(ids.map((id) => [id, 0]));

  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false;
    for (const e of edges) {
      if (!depth.has(e.from) || !depth.has(e.to)) continue;
      const want = depth.get(e.from)! + 1;
      if (want > depth.get(e.to)!) {
        depth.set(e.to, want);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const columns = new Map<number, string[]>();
  for (const id of ids) {
    const d = depth.get(id) ?? 0;
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d)!.push(id);
  }

  const placed = new Map<string, Placed>();
  const tallest = Math.max(1, ...[...columns.values()].map((c) => c.length));
  for (const [d, col] of columns) {
    // Centre each column vertically against the tallest one.
    const offset = ((tallest - col.length) * (NODE_H + GAP_Y)) / 2;
    col.forEach((id, i) => {
      placed.set(id, {
        id,
        label: nodes.find((n) => n.id === id)?.label ?? id,
        x: d * (NODE_W + GAP_X),
        y: offset + i * (NODE_H + GAP_Y),
      });
    });
  }

  const width = (columns.size || 1) * NODE_W + Math.max(0, columns.size - 1) * GAP_X;
  const height = tallest * NODE_H + Math.max(0, tallest - 1) * GAP_Y;
  return { placed: [...placed.values()], byId: placed, width, height };
}

export default function DiagramBlockView({ id, data, selected }: NodeProps<DiagramBlockType>) {
  const title = useInlineEdit(id, "title");
  const nodes = data.nodes ?? [];
  const edges = data.edges ?? [];

  const { placed, byId, width, height } = useMemo(() => layout(nodes, edges), [nodes, edges]);

  return (
    <BlockShell id={id} selected={!!selected} marker={data.marker}>
      <NodeResizer
        isVisible={!!selected}
        minWidth={220}
        minHeight={160}
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
        placeholder="Untitled diagram"
        value={data.title ?? ""}
        onFocus={title.onFocus}
        onChange={title.onChange}
        onBlur={title.onBlur}
      />

      <div style={{ flex: 1, minHeight: 0, padding: "0 12px 12px" }}>
        {placed.length === 0 ? (
          <div
            style={{
              height: "100%",
              display: "grid",
              placeItems: "center",
              fontSize: 13,
              color: "var(--text-faint)",
              textAlign: "center",
              padding: 8,
            }}
          >
            Empty. Ask the assistant to draw one.
          </div>
        ) : (
          <svg
            // viewBox does the scaling, so the diagram fits whatever the card is
            // resized to without re-running layout.
            viewBox={`-2 -2 ${width + 4} ${height + 4}`}
            preserveAspectRatio="xMidYMid meet"
            style={{ width: "100%", height: "100%", overflow: "visible" }}
          >
            <defs>
              <marker
                id={`arrow-${id}`}
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L8,4 L0,8 z" fill="var(--text-faint)" />
              </marker>
            </defs>

            {edges.map((e, i) => {
              const a = byId.get(e.from);
              const b = byId.get(e.to);
              if (!a || !b) return null;
              const x1 = a.x + NODE_W;
              const y1 = a.y + NODE_H / 2;
              const x2 = b.x;
              const y2 = b.y + NODE_H / 2;
              const mid = (x1 + x2) / 2;
              return (
                <g key={i}>
                  <path
                    d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke="var(--text-faint)"
                    strokeWidth={1.25}
                    markerEnd={`url(#arrow-${id})`}
                  />
                  {e.label && (
                    <text
                      x={mid}
                      y={(y1 + y2) / 2 - 4}
                      textAnchor="middle"
                      fontSize={10}
                      fill="var(--text-faint)"
                    >
                      {e.label}
                    </text>
                  )}
                </g>
              );
            })}

            {placed.map((n) => (
              <g key={n.id}>
                <rect
                  x={n.x}
                  y={n.y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={7}
                  fill="var(--surface-2)"
                  stroke="var(--border-strong)"
                />
                <text
                  x={n.x + NODE_W / 2}
                  y={n.y + NODE_H / 2 + 4}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--text)"
                >
                  {n.label.length > 16 ? `${n.label.slice(0, 15)}…` : n.label}
                </text>
              </g>
            ))}
          </svg>
        )}
      </div>
    </BlockShell>
  );
}
