import { useCallback, useRef, useState } from "react";
import { ViewportPortal, useReactFlow } from "@xyflow/react";
import { nanoid } from "nanoid";

import { useBoard } from "../store";
import type { InkStroke } from "../types";
import { useCanvasMode } from "./mode";
import { distanceToStroke, inkColor, pathFor } from "./stroke";

/** How close the eraser must come to a stroke, in canvas units. */
const ERASE_RADIUS = 14;

/**
 * The hand-drawn layer — the "red string" between findings.
 *
 * Committed strokes render inside ViewportPortal so they live in canvas
 * coordinates and pan and zoom with the board. The in-flight stroke renders in
 * the same space but is kept in local state, so a drag does not touch the store
 * (and therefore does not spam the undo stack) until the pen lifts.
 */
export default function InkLayer() {
  const ink = useBoard((s) => s.board.ink);
  const run = useBoard((s) => s.run);
  const { screenToFlowPosition } = useReactFlow();
  const { mode, color, size } = useCanvasMode();
  const penMode = mode === "draw" || mode === "erase";

  const [live, setLive] = useState<Array<[number, number, number]> | null>(null);
  const drawing = useRef(false);
  /** Strokes erased during the current drag, removed as one undo step. */
  const erased = useRef<string[]>([]);

  const toCanvas = useCallback(
    (e: React.PointerEvent): [number, number, number] => {
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      // Mice report 0 or 0.5; perfect-freehand simulates pressure from speed when it is flat.
      return [p.x, p.y, e.pressure > 0 ? e.pressure : 0.5];
    },
    [screenToFlowPosition],
  );

  const eraseAt = useCallback(
    (x: number, y: number) => {
      const current = useBoard.getState().board.ink;
      for (const s of current) {
        if (erased.current.includes(s.id)) continue;
        if (distanceToStroke(s, x, y) <= ERASE_RADIUS + s.size / 2) {
          erased.current.push(s.id);
          run({ t: "removeInk", strokeId: s.id }, "user");
        }
      }
    },
    [run],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (!penMode || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;

    const pt = toCanvas(e);
    if (mode === "erase") {
      erased.current = [];
      eraseAt(pt[0], pt[1]);
    } else {
      setLive([pt]);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const pt = toCanvas(e);
    if (mode === "erase") eraseAt(pt[0], pt[1]);
    else setLive((prev) => (prev ? [...prev, pt] : [pt]));
  };

  const finish = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    drawing.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }

    if (mode === "erase") {
      erased.current = [];
      return;
    }

    const points = live;
    setLive(null);
    // A tap is not a stroke; ignore it rather than storing an invisible dot.
    if (!points || points.length < 2) return;

    const stroke: InkStroke = { id: `ink-${nanoid(8)}`, points, color, size };
    run({ t: "addInk", stroke }, "user");
  };

  // Only a pen owns the pointer. "place" is another non-select mode, but it has
  // its own capture surface, and two overlapping ones would fight for the drag.
  const active = penMode;

  return (
    <>
      <ViewportPortal>
        {/* Zero-sized with overflow visible: children are positioned in canvas
            coordinates, which are frequently negative. */}
        <svg
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: 1,
            height: 1,
            overflow: "visible",
            pointerEvents: "none",
            // Below cards so a stroke never hides a note's text.
            zIndex: 0,
          }}
        >
          {ink.map((s) => (
            <path key={s.id} d={pathFor(s)} fill={inkColor(s.color)} />
          ))}
          {live && live.length > 1 && (
            <path d={pathFor({ points: live, size })} fill={inkColor(color)} opacity={0.9} />
          )}
        </svg>
      </ViewportPortal>

      {/* Capture surface. Only present while a pen is active, so it can never
          swallow clicks meant for blocks in select mode. */}
      {active && (
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finish}
          onPointerCancel={finish}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 5,
            cursor: mode === "erase" ? "cell" : "crosshair",
            touchAction: "none",
          }}
        />
      )}
    </>
  );
}
