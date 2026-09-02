import { create } from "zustand";

/**
 * The toast store, kept apart from the component that draws it.
 *
 * Not an arbitrary split. A module that exports both a component and ordinary
 * functions cannot be hot-reloaded by React Fast Refresh, so every edit to this
 * file used to invalidate it and cascade a reload into App.tsx — which resets the
 * open workspace and drops whoever is using the app back to the list. Splitting
 * the two kinds of export is what makes toasts editable without ejecting the
 * developer from the board they were looking at.
 */

export type ToastKind = "error" | "warn" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

// Errors get the longest of the three because they are the longest to read, and
// are the only kind that may carry a provider's own wording.
export const TIMEOUT_MS: Record<ToastKind, number> = {
  error: 5000,
  warn: 4000,
  info: 4000,
};

let seq = 0;

interface ToastState {
  items: Toast[];
  push: (kind: ToastKind, text: string) => void;
  dismiss: (id: number) => void;
}

export const useToasts = create<ToastState>((set, get) => ({
  items: [],
  push: (kind, text) => {
    const clean = text.trim();
    if (!clean) return;
    // Repeating the same failure should not stack — an agent loop can raise the
    // identical error on every step.
    if (get().items.some((t) => t.kind === kind && t.text === clean)) return;

    const id = ++seq;
    set((s) => ({ items: [...s.items, { id, kind, text: clean }] }));
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

/** Normalise anything thrown into readable text. */
export function toastError(e: unknown): void {
  const text = e instanceof Error ? e.message : String(e);
  useToasts.getState().push("error", text);
}

export function toastWarn(text: string): void {
  useToasts.getState().push("warn", text);
}
