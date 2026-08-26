import { create } from "zustand";

/**
 * Which document the reader is showing.
 *
 * A doc card lives deep inside React Flow's node tree while the reader is a
 * full-screen surface owned by the canvas screen, so the two cannot talk through
 * props. Keeping just the request here — filename and display title — means the
 * reader owns all the loading and the card stays a handle.
 */

interface ViewerState {
  file: string | null;
  title: string;
  open: (file: string, title: string) => void;
  close: () => void;
}

export const useDocumentViewer = create<ViewerState>((set) => ({
  file: null,
  title: "",
  open: (file, title) => set({ file, title }),
  close: () => set({ file: null, title: "" }),
}));

/** Callable from a block, which has no hook context of the screen. */
export function openDocument(file: string, title: string): void {
  useDocumentViewer.getState().open(file, title);
}
