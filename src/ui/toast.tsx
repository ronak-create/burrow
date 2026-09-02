import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { TIMEOUT_MS, useToasts, type Toast } from "./toastStore";

/**
 * Transient errors and warnings, shown top-right.
 *
 * Every screen used to render its own inline error strip, which meant a failure
 * was reported in a different place depending on which screen raised it — and a
 * failure raised by a screen you had since navigated away from was reported
 * nowhere at all. One surface, mounted once, fixes both.
 *
 * Everything times out, including errors. Errors used to persist on the argument
 * that an unread error is a bug you will hit again — but in practice the ones that
 * stuck were the ones already explained elsewhere in the UI ("no key for groq",
 * next to the setting that says the same thing), and a permanent card in the
 * corner of a canvas app is read once and then merely in the way. Hovering holds
 * a toast open, which covers the case the old rule was protecting: a long message
 * still being read does not vanish mid-sentence.
 */

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
        <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast: t, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [held, setHeld] = useState(false);
  const [closeHot, setCloseHot] = useState(false);

  // Held open while the pointer is on it, and the clock restarts when the
  // pointer leaves — someone who moved the mouse there to read it gets the full
  // duration again rather than the remainder of a timer they never saw.
  useEffect(() => {
    if (held) return;
    const timer = setTimeout(() => onDismiss(t.id), TIMEOUT_MS[t.kind]);
    return () => clearTimeout(timer);
  }, [t.id, t.kind, held, onDismiss]);

  return (
    <div
      role={t.kind === "error" ? "alert" : "status"}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
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
        onClick={() => onDismiss(t.id)}
        onMouseEnter={() => setCloseHot(true)}
        onMouseLeave={() => setCloseHot(false)}
        title="Dismiss"
        aria-label="Dismiss"
        style={{
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          width: 22,
          height: 22,
          borderRadius: "var(--r-sm)",
          border: "1px solid var(--border)",
          background: closeHot ? "var(--surface-2)" : "transparent",
          color: closeHot ? "var(--text)" : "var(--text-muted)",
        }}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
