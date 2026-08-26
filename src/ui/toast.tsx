import { useEffect } from "react";
import { create } from "zustand";
import { Icon } from "./icons";

/**
 * Transient errors and warnings, shown top-right.
 *
 * Every screen used to render its own inline error strip, which meant a failure
 * was reported in a different place depending on which screen raised it — and a
 * failure raised by a screen you had since navigated away from was reported
 * nowhere at all. One surface, mounted once, fixes both.
 *
 * Errors persist until dismissed, because an error the user did not read is a bug
 * they will hit again. Warnings and notices time out on their own.
 */

export type ToastKind = "error" | "warn" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

const TIMEOUT_MS: Record<ToastKind, number | null> = {
  error: null,
  warn: 8000,
  info: 5000,
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

    const ms = TIMEOUT_MS[kind];
    if (ms !== null) setTimeout(() => get().dismiss(id), ms);
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

export function Toasts() {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);

  // Escape clears the newest, matching every other dismissable surface in the app.
  useEffect(() => {
    if (items.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss(items[items.length - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, dismiss]);

  if (items.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 14,
        right: 14,
        // Above the settings page, which is the highest normal surface.
        zIndex: 400,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 400,
        // The strip must never swallow clicks meant for the canvas beneath it.
        pointerEvents: "none",
      }}
    >
      {items.map((t) => (
        <div
          key={t.id}
          role={t.kind === "error" ? "alert" : "status"}
          style={{
            pointerEvents: "auto",
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "11px 12px",
            borderRadius: "var(--r-md)",
            background: "var(--surface)",
            border: `1px solid ${t.kind === "error" ? "var(--danger-line)" : "var(--border-strong)"}`,
            boxShadow: "var(--shadow-pop)",
          }}
        >
          <span
            style={{
              flexShrink: 0,
              marginTop: 5,
              width: 7,
              height: 7,
              borderRadius: 99,
              background: t.kind === "error" ? "var(--danger)" : "var(--text-muted)",
            }}
          />
          <span
            className="selectable"
            style={{
              flex: 1,
              fontSize: 13,
              lineHeight: 1.45,
              color: "var(--text)",
              // Provider errors carry long unbroken payloads; wrap rather than clip.
              overflowWrap: "anywhere",
              whiteSpace: "pre-wrap",
            }}
          >
            {t.text}
          </span>
          <button
            onClick={() => dismiss(t.id)}
            title="Dismiss"
            aria-label="Dismiss"
            style={{
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              width: 20,
              height: 20,
              color: "var(--text-faint)",
            }}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
