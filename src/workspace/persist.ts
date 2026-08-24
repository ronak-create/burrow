import { useEffect } from "react";
import { useBoard } from "../canvas/store";
import type { Block, Board } from "../canvas/types";
import { writeBoard } from "./api";

/**
 * React Flow decorates nodes with runtime state — selection, drag flags, measured
 * sizes. None of that is content, so it is stripped before writing. board.json
 * stays a clean description of what the user made, which matters because it is
 * also what the assistant reads and what the user may open in a text editor.
 */
export function cleanForDisk(board: Board): Board {
  return {
    ...board,
    nodes: board.nodes.map((n) => {
      const { selected, dragging, measured, ...rest } = n as Block & {
        selected?: boolean;
        dragging?: boolean;
        measured?: unknown;
      };
      void selected;
      void dragging;
      void measured;
      return rest as Block;
    }),
    edges: board.edges.map(({ selected, ...e }) => {
      void selected;
      return e;
    }),
  };
}

const SAVE_DELAY = 700;

/**
 * Debounced autosave. Writes are atomic on the Rust side (temp file + rename), so
 * a crash mid-save cannot truncate a board.
 */
export function useAutosave(root: string | null, id: string | null) {
  const dirty = useBoard((s) => s.dirty);
  const markClean = useBoard((s) => s.markClean);

  useEffect(() => {
    if (!dirty || !root || !id) return;
    const timer = setTimeout(async () => {
      try {
        await writeBoard(root, id, cleanForDisk(useBoard.getState().board));
        markClean();
      } catch (e) {
        // Leave `dirty` set so the next change retries rather than losing work.
        console.error("autosave failed", e);
      }
    }, SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [dirty, root, id, markClean]);
}

/** Flush immediately — used when leaving a workspace, where debouncing would lose the tail. */
export async function saveNow(root: string, id: string) {
  const s = useBoard.getState();
  if (!s.dirty) return;
  await writeBoard(root, id, cleanForDisk(s.board));
  s.markClean();
}
