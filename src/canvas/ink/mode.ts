import { create } from "zustand";
import { INK_COLORS, INK_SIZES } from "./stroke";

/**
 * Canvas interaction mode. Drawing has to take over the pointer completely —
 * React Flow's panning, marquee selection and node dragging are all suppressed
 * while a pen is active, or a stroke turns into an accidental drag.
 */
export type CanvasMode = "select" | "draw" | "erase";

interface ModeState {
  mode: CanvasMode;
  color: string;
  size: number;
  setMode: (m: CanvasMode) => void;
  setColor: (c: string) => void;
  setSize: (s: number) => void;
}

export const useCanvasMode = create<ModeState>((set) => ({
  mode: "select",
  color: INK_COLORS[0].key,
  size: INK_SIZES[1],
  setMode: (mode) => set({ mode }),
  setColor: (color) => set({ color }),
  setSize: (size) => set({ size }),
}));
