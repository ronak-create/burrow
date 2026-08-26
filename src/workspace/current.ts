import { create } from "zustand";

/**
 * Which workspace is open.
 *
 * Blocks are rendered by React Flow from board JSON, so they receive only their
 * own `data` — there is no prop path from the screen down to a card. But a doc or
 * image block stores a filename relative to its workspace folder and has to
 * resolve it against the folder to show anything. Rather than denormalising the
 * root path into every block (which would break the moment a workspace moved, and
 * bloat the board file), the open workspace is ambient state that blocks read.
 */

interface CurrentWorkspace {
  root: string | null;
  id: string | null;
  set: (root: string, id: string) => void;
  clear: () => void;
}

export const useCurrentWorkspace = create<CurrentWorkspace>((set) => ({
  root: null,
  id: null,
  set: (root, id) => set({ root, id }),
  clear: () => set({ root: null, id: null }),
}));
