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
 * Write the board and clear the dirty flag — but only if nothing changed while
 * the write was in flight.
 *
 * The reference check is load-bearing. A write is asynchronous, and an edit
 * landing during one used to be marked clean along with the data that actually
 * reached disk: the store held the newer board, `dirty` was false, and nothing
 * scheduled another save. The edit survived only until the app closed, and
 * `saveNow` on the way out returned early precisely because `dirty` was false.
 * Every edit made in the ~700ms debounce plus write window was at risk.
 *
 * The store replaces `board` with a new object on every edit, so identity is an
 * exact test for "has anything changed since the snapshot".
 */
export async function flush(root: string, id: string): Promise<void> {
  const snapshot = useBoard.getState().board;
  await writeBoard(root, id, cleanForDisk(snapshot));
  if (useBoard.getState().board === snapshot) useBoard.getState().markClean();
}

/**
 * Debounced autosave. Writes are atomic on the Rust side (temp file + rename), so
 * a crash mid-save cannot truncate a board.
 */
export function useAutosave(root: string | null, id: string | null) {
  const dirty = useBoard((s) => s.dirty);

  useEffect(() => {
    if (!dirty || !root || !id) return;
    const timer = setTimeout(() => {
      // Leave `dirty` set on failure so the next change retries rather than
      // losing work. There is no toast here: autosave failures repeat every few
      // hundred milliseconds, and a wall of identical toasts would bury the one
      // message that matters, which is the one shown when leaving the workspace.
      void flush(root, id).catch((e) => console.error("autosave failed", e));
    }, SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [dirty, root, id]);
}

/** Flush immediately — used when leaving a workspace, where debouncing would lose the tail. */
export async function saveNow(root: string, id: string) {
  if (!useBoard.getState().dirty) return;
  await flush(root, id);
}
