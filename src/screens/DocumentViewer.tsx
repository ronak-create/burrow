import { useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";

import { useDocumentViewer } from "./documentViewerState";
import { useCurrentWorkspace } from "../workspace/current";
import { readDocumentText } from "../workspace/api";
import { useBoard } from "../canvas/store";
import { findFreeSpot, boardCentre } from "../canvas/placement";
import { DEFAULT_SIZE, type Block } from "../canvas/types";
import { Icon } from "../ui/icons";
import { toastError } from "../ui/toastStore";

/**
 * The reading surface (spec G).
 *
 * PDF, Word and Markdown all arrive here as extracted plain text and get the same
 * treatment, rather than three viewers with three sets of quirks. What the user
 * reads is exactly what the assistant would be given, which means an excerpt can
 * never quote something the model cannot see.
 *
 * Selecting text and clicking "Excerpt" puts it on the board as a plain note. Per
 * spec G that note carries no live backlink to the source: the user pulled it out
 * themselves and already knows where it came from, and a link that has to survive
 * the document being re-imported or deleted is a lot of machinery for something
 * nobody asked for.
 */

export default function DocumentViewer() {
  const { file, title, close } = useDocumentViewer();
  const { root, id: wsId } = useCurrentWorkspace();
  const run = useBoard((s) => s.run);

  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!file || !root || !wsId) return;
    let live = true;
    setLoading(true);
    setText(null);
    setSelection("");
    readDocumentText(root, wsId, file)
      .then((t) => live && setText(t))
      .catch((e) => {
        if (!live) return;
        toastError(e);
        close();
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [file, root, wsId, close]);

  useEffect(() => {
    if (!file) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [file, close]);

  if (!file) return null;

  /** Read the live selection, but only when it is inside this document's body. */
  function captureSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !bodyRef.current) {
      setSelection("");
      return;
    }
    const anchor = sel.anchorNode;
    setSelection(anchor && bodyRef.current.contains(anchor) ? sel.toString().trim() : "");
  }

  function excerpt() {
    const body = selection.trim();
    if (!body) return;
    const board = useBoard.getState().board;
    const size = DEFAULT_SIZE.note;
    const pos = findFreeSpot(board, size, boardCentre(board));
    run(
      {
        t: "addBlock",
        block: {
          id: `note-${nanoid(8)}`,
          type: "note",
          position: pos,
          width: size.width,
          height: size.height,
          zIndex: 1,
          // Titled with the source so the note is identifiable on the board, but
          // the body is the user's words as pulled — nothing is paraphrased.
          data: { title: title || file, body },
        } as Block,
      },
      "user",
    );
    setSelection("");
    window.getSelection()?.removeAllRanges();
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 150,
        background: "var(--bg)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "14px 22px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        <button
          onClick={close}
          title="Back"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "var(--text-muted)",
            fontSize: 14,
          }}
        >
          <Icon name="back" size={16} /> Back
        </button>
        <h2
          style={{
            fontSize: 16,
            margin: 0,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title || file}
        </h2>

        <button
          onClick={excerpt}
          disabled={!selection}
          title={
            selection
              ? "Put the selected text on the board as a note"
              : "Select some text to excerpt it"
          }
          style={{
            marginLeft: "auto",
            padding: "7px 14px",
            borderRadius: "var(--r-sm)",
            fontSize: 14,
            background: selection ? "var(--accent)" : "var(--surface-2)",
            color: selection ? "var(--on-accent)" : "var(--text-faint)",
            cursor: selection ? "pointer" : "not-allowed",
          }}
        >
          Excerpt to board
        </button>
      </header>

      <div style={{ flex: 1, overflowY: "auto" }} onMouseUp={captureSelection} onKeyUp={captureSelection}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "28px 24px 80px" }}>
          {loading && <div style={{ color: "var(--text-faint)", fontSize: 14 }}>Reading…</div>}

          {text !== null && text.trim() === "" && (
            <div style={{ color: "var(--text-faint)", fontSize: 14 }}>
              This document has no extractable text. If it is a scanned PDF, the pages are
              images and would need OCR.
            </div>
          )}

          {text && (
            <div
              ref={bodyRef}
              className="selectable"
              style={{
                // Extracted text carries its own line breaks and column layout;
                // pre-wrap preserves them instead of collapsing to one block.
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                fontSize: 15,
                lineHeight: 1.7,
                color: "var(--text)",
              }}
            >
              {text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
