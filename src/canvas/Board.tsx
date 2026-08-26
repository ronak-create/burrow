import { useCallback, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type Node as RFNode,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { nanoid } from "nanoid";

import NoteBlockView from "./blocks/NoteBlock";
import FrameBlockView from "./blocks/FrameBlock";
import ShapeBlockView from "./blocks/ShapeBlock";
import TextBlockView from "./blocks/TextBlock";
import TableBlockView from "./blocks/TableBlock";
import DiagramBlockView from "./blocks/DiagramBlock";
import DocBlockView from "./blocks/DocBlock";
import ImageBlockView from "./blocks/ImageBlock";
import FloatingEdge from "./edges/FloatingEdge";
import InkLayer from "./ink/InkLayer";
import PlaceLayer from "./PlaceLayer";
import { useProviders } from "../providers/registry";
import { useCanvasMode } from "./ink/mode";
import type { Command } from "./commands";
import { useBoard } from "./store";
import {
  blockRect,
  centreInside,
  frameMembers,
  owningFrame,
  type Block,
  type FrameData,
  type XY,
} from "./types";

const nodeTypes = {
  note: NoteBlockView,
  frame: FrameBlockView,
  shape: ShapeBlockView,
  text: TextBlockView,
  table: TableBlockView,
  diagram: DiagramBlockView,
  doc: DocBlockView,
  image: ImageBlockView,
};

// `default` is overridden too, so edges loaded from disk without an explicit type
// (and any the assistant creates) float as well.
const edgeTypes = { floating: FloatingEdge, default: FloatingEdge };

/** Every edge floats — see edges/floating.ts for why fixed handles are wrong here. */
const defaultEdgeOptions = { type: "floating" } as const;

interface DragSession {
  /** Position each affected block held when the drag began — the undo target. */
  start: Map<string, XY>;
  /** Blocks moving only because a frame they sit inside is moving. */
  carried: string[];
  anchorId: string;
  anchorStart: XY;
}

export default function Board() {
  const board = useBoard((s) => s.board);
  const run = useBoard((s) => s.run);
  const record = useBoard((s) => s.record);
  const applyTransient = useBoard((s) => s.applyTransient);
  const setNodesTransient = useBoard((s) => s.setNodesTransient);
  const setEdgesTransient = useBoard((s) => s.setEdgesTransient);
  const setViewport = useBoard((s) => s.setViewport);

  const drag = useRef<DragSession | null>(null);
  /** Size each block held when a resize began, keyed by id. */
  const resizeStart = useRef<Map<string, { width?: number; height?: number }>>(new Map());

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const current = useBoard.getState().board;

      // Deletions are real edits — route them through the command layer so they
      // land on the undo stack and take their edges with them.
      const removals = changes.filter((c) => c.type === "remove");
      if (removals.length) {
        const cmds = removals.map((c): Command => ({ t: "removeBlock", id: (c as { id: string }).id }));
        run(
          cmds.length === 1 ? cmds[0] : { t: "batch", label: `delete ${cmds.length} blocks`, commands: cmds },
          "user",
        );
      }

      // Track resize start/end so a resize is one undo step, not one per frame.
      for (const c of changes) {
        if (c.type !== "dimensions") continue;
        const id = c.id;
        if (c.resizing && !resizeStart.current.has(id)) {
          const n = current.nodes.find((x) => x.id === id);
          if (n) resizeStart.current.set(id, { width: n.width, height: n.height });
        } else if (c.resizing === false && resizeStart.current.has(id)) {
          const before = resizeStart.current.get(id)!;
          resizeStart.current.delete(id);
          const n = current.nodes.find((x) => x.id === id);
          if (n && (n.width !== before.width || n.height !== before.height)) {
            const fwd: Command[] = [{ t: "resizeBlock", id, size: { width: n.width, height: n.height } }];
            const inv: Command[] = [{ t: "resizeBlock", id, size: before }];

            // Drawing a frame around blocks is the deliberate way to group them, so
            // a resize adopts whatever it now encloses (and releases what it no longer does).
            if (n.type === "frame") {
              const was = (n.data as FrameData).contains ?? [];
              const now = current.nodes
                .filter((b) => b.id !== id && b.type !== "frame" && centreInside(blockRect(n), b))
                .map((b) => b.id);
              if (was.length !== now.length || now.some((x) => !was.includes(x))) {
                fwd.push({ t: "updateBlock", id, patch: { contains: now } });
                inv.push({ t: "updateBlock", id, patch: { contains: was } });
              }
            }

            record(
              fwd.length === 1 ? fwd[0] : { t: "batch", label: "resize", commands: fwd },
              inv.length === 1 ? inv[0] : { t: "batch", label: "resize", commands: inv },
              "user",
              n.type === "frame" ? "resize frame" : "resize block",
            );
          }
        }
      }

      // Everything else (selection, in-flight position/size) is presentational.
      const rest = changes.filter((c) => c.type !== "remove");
      if (rest.length) {
        setNodesTransient(applyNodeChanges(rest, current.nodes as RFNode[]) as Block[]);
      }
    },
    [run, record, setNodesTransient],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const current = useBoard.getState().board;
      const removals = changes.filter((c) => c.type === "remove");
      if (removals.length) {
        const cmds = removals.map((c): Command => ({ t: "disconnect", edgeId: (c as { id: string }).id }));
        run(
          cmds.length === 1 ? cmds[0] : { t: "batch", label: "disconnect", commands: cmds },
          "user",
        );
      }
      const rest = changes.filter((c) => c.type !== "remove");
      if (rest.length) setEdgesTransient(applyEdgeChanges(rest, current.edges));
    },
    [run, setEdgesTransient],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      run(
        {
          t: "connect",
          // No handle is stored: floating edges pick their own attachment points,
          // so a connection stays sensible when either block is moved.
          edge: { id: `e-${nanoid(8)}`, source: c.source, target: c.target, type: "floating" },
        },
        "user",
      );
    },
    [run],
  );

  const onNodeDragStart = useCallback((_: unknown, node: RFNode, nodes: RFNode[]) => {
    const current = useBoard.getState().board;
    const moving = nodes.length ? nodes : [node];
    const start = new Map<string, XY>();
    const carried: string[] = [];

    for (const n of moving) start.set(n.id, { ...n.position });

    // A frame carries only the blocks it actually owns — not whatever happens to be
    // underneath it. See FrameData.contains.
    for (const n of moving) {
      if (n.type !== "frame") continue;
      for (const child of frameMembers(current, n.id)) {
        if (!start.has(child.id)) {
          start.set(child.id, { ...child.position });
          carried.push(child.id);
        }
      }
    }

    drag.current = { start, carried, anchorId: node.id, anchorStart: { ...node.position } };
  }, []);

  const onNodeDrag = useCallback(
    (_: unknown, node: RFNode) => {
      const s = drag.current;
      if (!s || !s.carried.length || node.id !== s.anchorId) return;
      const dx = node.position.x - s.anchorStart.x;
      const dy = node.position.y - s.anchorStart.y;
      for (const id of s.carried) {
        const from = s.start.get(id);
        if (from) applyTransient({ t: "moveBlock", id, position: { x: from.x + dx, y: from.y + dy } });
      }
    },
    [applyTransient],
  );

  const onNodeDragStop = useCallback(() => {
    const s = drag.current;
    drag.current = null;
    if (!s) return;

    const current = useBoard.getState().board;
    const forward: Command[] = [];
    const back: Command[] = [];
    for (const [id, from] of s.start) {
      const n = current.nodes.find((x) => x.id === id);
      if (!n || (n.position.x === from.x && n.position.y === from.y)) continue;
      forward.push({ t: "moveBlock", id, position: { ...n.position } });
      back.push({ t: "moveBlock", id, position: from });
    }

    // Dropping a block inside a frame joins it; dragging it out leaves. Frames have
    // not moved in `current`, so their membership here is still the pre-drag state,
    // which is exactly what the inverse needs.
    for (const [id] of s.start) {
      // Blocks that only moved because their frame moved keep their membership.
      if (s.carried.includes(id)) continue;
      const node = current.nodes.find((x) => x.id === id);
      if (!node || node.type === "frame") continue;

      const before = owningFrame(current, id);
      const after = current.nodes.find(
        (f) => f.type === "frame" && centreInside(blockRect(f), node),
      );
      if (before?.id === after?.id) continue;

      if (before) {
        const list = (before.data as FrameData).contains ?? [];
        forward.push({ t: "updateBlock", id: before.id, patch: { contains: list.filter((x) => x !== id) } });
        back.push({ t: "updateBlock", id: before.id, patch: { contains: list } });
      }
      if (after) {
        const list = (after.data as FrameData).contains ?? [];
        forward.push({ t: "updateBlock", id: after.id, patch: { contains: [...list, id] } });
        back.push({ t: "updateBlock", id: after.id, patch: { contains: list } });
      }
    }

    if (!forward.length) return;

    const label = forward.length > 1 ? `move ${forward.length} blocks` : "move block";
    record(
      forward.length === 1 ? forward[0] : { t: "batch", label, commands: forward },
      back.length === 1 ? back[0] : { t: "batch", label, commands: back },
      "user",
      label,
    );
  }, [record]);

  const onMoveEnd = useCallback((_: unknown, v: Viewport) => setViewport(v), [setViewport]);

  const defaultViewport = useMemo(() => board.viewport, []); // eslint-disable-line react-hooks/exhaustive-deps

  // While a pen is active React Flow must stop competing for the pointer, or a
  // stroke turns into a pan or an accidental node drag.
  const penActive = useCanvasMode((s) => s.mode !== "select");

  const pattern = useProviders((s) => s.settings.canvasPattern);
  const shade = useProviders((s) => s.settings.canvasShade);
  // colour-mix keeps the backdrop on the theme's own ramp, so the same setting
  // reads correctly in dark and light without storing two values.
  const canvasBg = `color-mix(in srgb, var(--card) ${shade}%, var(--bg))`;

  return (
    <ReactFlow
      nodes={board.nodes as RFNode[]}
      edges={board.edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeDragStart={onNodeDragStart}
      onNodeDrag={onNodeDrag}
      onNodeDragStop={onNodeDragStop}
      onMoveEnd={onMoveEnd}
      defaultViewport={defaultViewport}
      minZoom={0.1}
      maxZoom={3}
      /* Loose mode lets a connection land anywhere on a card rather than forcing
         the user to hit a 7px dot. */
      connectionMode={"loose" as never}
      selectionOnDrag={!penActive}
      nodesDraggable={!penActive}
      nodesConnectable={!penActive}
      elementsSelectable={!penActive}
      // Middle and right drag pan; left is left free for marquee select, or for the
      // pen when one is active. So the board stays navigable without leaving the pen.
      panOnDrag={[1, 2]}
      elevateNodesOnSelect
      elevateEdgesOnSelect
      deleteKeyCode={["Delete", "Backspace"]}
      multiSelectionKeyCode={["Meta", "Control", "Shift"]}
      proOptions={{ hideAttribution: true }}
      style={{ background: canvasBg }}
    >
      {pattern !== "plain" && (
        <Background
          variant={pattern === "grid" ? BackgroundVariant.Lines : BackgroundVariant.Dots}
          gap={22}
          size={1}
          color="var(--canvas-dot)"
        />
      )}
      <InkLayer />
      <PlaceLayer />
    </ReactFlow>
  );
}
