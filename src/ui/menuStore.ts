import { create } from "zustand";

/**
 * What the menu bar is allowed to do to whichever screen is open.
 *
 * The bar lives above both screens in App, but most of what a menu should offer
 * — undo, zoom, the assistant — belongs to the canvas and exists only while a
 * board is open. Rather than lift that state up into App, each screen registers
 * its own handlers here on mount and clears them on unmount, and the menu greys
 * out whatever is absent. The workspace list therefore shows an honest File menu
 * without CanvasScreen needing to know a menu bar exists at all.
 *
 * Split from the component for the same reason toastStore is: a module that
 * exports both a component and plain functions cannot be hot-reloaded by Fast
 * Refresh, and an invalidation here would cascade into App and drop whoever is
 * using the app back to the workspace list.
 */

export interface CanvasActions {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  fitView: () => void;
  openFiles: () => void;
  openSettings: () => void;
  toggleAssistant: () => void;
  assistantVisible: boolean;
  /** Saves and returns to the list — the same path as the back button. */
  closeWorkspace: () => void;
  /** Copies this workspace's folder somewhere the user picks. */
  exportProject: () => void;
}

export interface BrowserActions {
  newWorkspace: () => void;
  /** The list screen has its own Settings dialog, so File > Settings works here too. */
  openSettings: () => void;
  /** Adopts a folder as a new workspace. Offered from the list, which is where
   *  the imported project appears. */
  importProject: () => void;
}

interface MenuState {
  canvas: CanvasActions | null;
  browser: BrowserActions | null;
  setCanvas: (a: CanvasActions | null) => void;
  setBrowser: (a: BrowserActions | null) => void;
}

export const useMenu = create<MenuState>((set) => ({
  canvas: null,
  browser: null,
  setCanvas: (canvas) => set({ canvas }),
  setBrowser: (browser) => set({ browser }),
}));
