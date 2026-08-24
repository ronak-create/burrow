import { create } from "zustand";
import type { Viewport } from "@xyflow/react";
import { apply, describe, invert, type Command, type Origin } from "./commands";
import { emptyBoard, type Block, type Board, type BoardEdge } from "./types";

/**
 * The single board store. Both the UI and the assistant mutate through `run`, so
 * `past` is one shared timeline — Ctrl+Z undoes whichever edit happened last no
 * matter who made it (spec C).
 *
 * Two escape hatches exist for things that are not edits:
 *
 *   `applyTransient` — mid-drag position updates and viewport changes. Applied to
 *   the board but never pushed to history, so a drag is one undo step rather than
 *   sixty, and panning is not undoable at all.
 *
 *   `record` — pushes a history entry for a change that was already applied
 *   transiently, using an inverse captured before the interaction began.
 */

export interface HistoryEntry {
  cmd: Command;
  inv: Command;
  origin: Origin;
  label: string;
  at: number;
}

interface BoardState {
  board: Board;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** True when the board differs from what is on disk. Drives autosave. */
  dirty: boolean;

  run: (cmd: Command, origin: Origin) => void;
  applyTransient: (cmd: Command) => void;
  /**
   * React Flow emits changes that are not edits — selection, hover, and the
   * position/dimension stream during a drag or resize. These go straight to the
   * board with no history; the interaction commits one entry via `record` when it
   * ends, so a drag is one Ctrl+Z rather than sixty.
   */
  setNodesTransient: (nodes: Block[]) => void;
  setEdgesTransient: (edges: BoardEdge[]) => void;
  record: (cmd: Command, inv: Command, origin: Origin, label?: string) => void;
  undo: () => void;
  redo: () => void;
  setViewport: (v: Viewport) => void;
  /** Load a board from disk. Clears history — you cannot undo past a file load. */
  load: (board: Board) => void;
  markClean: () => void;
}

const LIMIT = 300;

export const useBoard = create<BoardState>((set, get) => ({
  board: emptyBoard(),
  past: [],
  future: [],
  dirty: false,

  run: (cmd, origin) => {
    const { board, past } = get();
    const inv = invert(board, cmd);
    const next = apply(board, cmd);
    // A no-op (missing target, duplicate id) must not occupy an undo slot.
    if (inv === null) {
      if (next !== board) set({ board: next, dirty: true });
      return;
    }
    const entry: HistoryEntry = { cmd, inv, origin, label: describe(cmd), at: Date.now() };
    set({
      board: next,
      past: [...past, entry].slice(-LIMIT),
      future: [], // a new edit discards the redo branch
      dirty: true,
    });
  },

  applyTransient: (cmd) => {
    set((s) => ({ board: apply(s.board, cmd), dirty: true }));
  },

  setNodesTransient: (nodes) => set((s) => ({ board: { ...s.board, nodes }, dirty: true })),
  setEdgesTransient: (edges) => set((s) => ({ board: { ...s.board, edges }, dirty: true })),

  record: (cmd, inv, origin, label) => {
    set((s) => ({
      past: [...s.past, { cmd, inv, origin, label: label ?? describe(cmd), at: Date.now() }].slice(
        -LIMIT,
      ),
      future: [],
      dirty: true,
    }));
  },

  undo: () => {
    const { board, past, future } = get();
    const entry = past[past.length - 1];
    if (!entry) return;
    set({
      board: apply(board, entry.inv),
      past: past.slice(0, -1),
      future: [entry, ...future],
      dirty: true,
    });
  },

  redo: () => {
    const { board, past, future } = get();
    const [entry, ...rest] = future;
    if (!entry) return;
    set({
      board: apply(board, entry.cmd),
      past: [...past, entry].slice(-LIMIT),
      future: rest,
      dirty: true,
    });
  },

  setViewport: (viewport) => {
    // Panning and zooming are not edits: no history, and no dirty flag beyond the
    // viewport itself, which is persisted opportunistically with the next save.
    set((s) => ({ board: { ...s.board, viewport } }));
  },

  load: (board) => set({ board, past: [], future: [], dirty: false }),

  markClean: () => set({ dirty: false }),
}));

/** Convenience for the agent layer, which always acts with origin "agent". */
export const runAsAgent = (cmd: Command) => useBoard.getState().run(cmd, "agent");
export const runAsUser = (cmd: Command) => useBoard.getState().run(cmd, "user");
