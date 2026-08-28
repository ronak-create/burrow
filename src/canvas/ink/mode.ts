import { create } from "zustand";
import { INK_COLORS, INK_SIZES } from "./stroke";
import type { BlockKind } from "../types";

/**
 * Canvas interaction mode. Drawing has to take over the pointer completely —
 * React Flow's panning, marquee selection and node dragging are all suppressed
 * while a pen is active, or a stroke turns into an accidental drag.
 */
export type CanvasMode = "select" | "draw" | "erase" | "place";

/** What a click or drag will create while in "place" mode. */
export interface PendingBlock {
  kind: BlockKind;
  variant?: "rectangle" | "ellipse";
}

interface ModeState {
  mode: CanvasMode;
  color: string;
  size: number;
  /** Border thickness for newly placed rectangle/ellipse shapes, in px. */
  shapeStrokeWidth: number;
  /** Only meaningful while mode is "place". */
  pending: PendingBlock | null;
  setMode: (m: CanvasMode) => void;
  setColor: (c: string) => void;
  setSize: (s: number) => void;
  setShapeStrokeWidth: (w: number) => void;
  /**
   * Arm the canvas to create a block. Selecting the tool no longer creates
   * anything on its own — the user draws the block where and how big they want
   * it, the way any drawing tool behaves.
   */
  arm: (p: PendingBlock) => void;
  /** Back to selecting, discarding anything armed. */
  disarm: () => void;
}

export const useCanvasMode = create<ModeState>((set, get) => ({
  mode: "select",
  color: INK_COLORS[0].key,
  size: INK_SIZES[1],
  shapeStrokeWidth: 2,
  pending: null,
  // Switching to any other mode drops what was armed, so a stale pending block
  // cannot be created by a later click.
  setMode: (mode) => set({ mode, pending: mode === "place" ? get().pending : null }),
  setColor: (color) => set({ color }),
  setSize: (size) => set({ size }),
  setShapeStrokeWidth: (shapeStrokeWidth) => set({ shapeStrokeWidth }),
  arm: (pending) => set({ mode: "place", pending }),
  disarm: () => set({ mode: "select", pending: null }),
}));
