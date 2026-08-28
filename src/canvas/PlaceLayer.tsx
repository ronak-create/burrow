import { useCallback, useEffect, useRef, useState } from "react";
import { ViewportPortal, useReactFlow } from "@xyflow/react";
import { nanoid } from "nanoid";

import { useBoard } from "./store";
import { useCanvasMode } from "./ink/mode";
import {
  DEFAULT_SIZE,
  centreInside,
  type Block,
  type BlockKind,
  type Rect,
} from "./types";

/**
 * Drawing a block onto the canvas.
 *
 * Picking a tool used to create the block immediately, at the centre of the
 * viewport — so the user chose "rectangle" and something appeared somewhere they
 * were not looking, at a size they did not choose. Every drawing tool ever made
 * works the other way round: the tool arms, the cursor changes, and the shape is
 * drawn where and how big the user wants it.
 *
 * A click without a drag still creates something, at the block kind's default
 * size, because demanding a drag to place a note would be worse than the problem
 * it solves.
 */

/** Below this, in canvas units, the gesture was a click and not a drag. */
const DRAG_THRESHOLD = 6;

function newBlockData(
  kind: BlockKind,
  variant?: "rectangle" | "ellipse",
  color?: string,
  strokeWidth?: number,
) {
  switch (kind) {
    case "shape":
      return { variant: variant ?? "rectangle", color: color ?? "slate", strokeWidth };
    case "text":
      return { text: "" };
    case "note":
      return { title: "", body: "" };
    case "frame":
      return { label: "" };
    case "table":
      return { title: "", columns: ["Column A", "Column B"], rows: [["", ""]] };
    case "diagram":
      return { title: "", nodes: [], edges: [] };
    case "doc":
      return { title: "", file: "" };
    case "image":
      return { title: "", file: "" };
  }
}

export default function PlaceLayer() {
  const run = useBoard((s) => s.run);
  const { screenToFlowPosition } = useReactFlow();
  const mode = useCanvasMode((s) => s.mode);
  const pending = useCanvasMode((s) => s.pending);
  const disarm = useCanvasMode((s) => s.disarm);
  // New shapes adopt the current ink colour, so pen and shapes feel like one set
  // of drawing tools rather than two.
  const inkStrokeColor = useCanvasMode((s) => s.color);
  const shapeStrokeWidth = useCanvasMode((s) => s.shapeStrokeWidth);

  const [rect, setRect] = useState<Rect | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  // Escape cancels an armed tool, the way it dismisses every other transient
  // state here. Without it the only way out was to place something and delete it.
  useEffect(() => {
    if (mode !== "place") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        start.current = null;
        setRect(null);
        disarm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, disarm]);

  const toCanvas = useCallback(
    (e: React.PointerEvent) => screenToFlowPosition({ x: e.clientX, y: e.clientY }),
    [screenToFlowPosition],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toCanvas(e);
    start.current = p;
    setRect({ x: p.x, y: p.y, width: 0, height: 0 });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const p = toCanvas(e);
    const s = start.current;
    // Normalised, so dragging up or left works the same as down or right.
    setRect({
      x: Math.min(s.x, p.x),
      y: Math.min(s.y, p.y),
      width: Math.abs(p.x - s.x),
      height: Math.abs(p.y - s.y),
    });
  };

  const finish = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }

    const drawn = rect;
    setRect(null);
    if (!s || !pending) return;

    const size = DEFAULT_SIZE[pending.kind];
    const isDrag =
      drawn !== null && (drawn.width >= DRAG_THRESHOLD || drawn.height >= DRAG_THRESHOLD);

    // A drag sets both position and size; a click drops the default size centred
    // on the point, which is where the user was pointing.
    const box: Rect = isDrag
      ? {
          x: drawn.x,
          y: drawn.y,
          width: Math.max(drawn.width, 40),
          height: Math.max(drawn.height, 32),
        }
      : { x: s.x - size.width / 2, y: s.y - size.height / 2, ...size };

    const id = `${pending.kind}-${nanoid(8)}`;

    // FrameData's contract: a block joins a frame when it is dragged in, or when
    // the frame is drawn or resized around it. Resize already did this; drawing
    // did not, so a frame drawn deliberately around existing work adopted
    // nothing and then dragged away empty.
    let contains: string[] = [];
    if (pending.kind === "frame") {
      const board = useBoard.getState().board;
      contains = board.nodes
        .filter((b) => b.type !== "frame" && centreInside(box, b))
        .map((b) => b.id);
    }

    run(
      {
        t: "addBlock",
        block: {
          id,
          type: pending.kind,
          position: { x: box.x, y: box.y },
          width: box.width,
          height: box.height,
          // Frames are containers and must sit behind the blocks they enclose.
          zIndex: pending.kind === "frame" ? 0 : 1,
          data: {
            ...newBlockData(pending.kind, pending.variant, inkStrokeColor, shapeStrokeWidth),
            ...(contains.length ? { contains } : {}),
          },
        } as Block,
      },
      "user",
    );

    // One tool, one block — matching how the shape tools in a drawing app behave,
    // and leaving the board immediately selectable so the new block can be typed
    // into without a second trip to the toolbar.
    disarm();
  };

  if (mode !== "place" || !pending) return null;

  const ellipse = pending.kind === "shape" && pending.variant === "ellipse";

  return (
    <>
      {rect && (rect.width > 1 || rect.height > 1) && (
        <ViewportPortal>
          <div
            style={{
              position: "absolute",
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
              border: "1px dashed var(--accent)",
              background: "var(--accent-wash)",
              borderRadius: ellipse ? "50%" : "var(--r-md)",
              pointerEvents: "none",
              zIndex: 6,
            }}
          />
        </ViewportPortal>
      )}

      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 5,
          cursor: "crosshair",
        }}
      />
    </>
  );
}
