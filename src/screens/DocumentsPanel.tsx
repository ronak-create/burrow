import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { nanoid } from "nanoid";

import {
  deleteDocument,
  importDocument,
  listDocuments,
  type DocumentInfo,
} from "../workspace/api";
import { useCurrentWorkspace } from "../workspace/current";
import { useBoard } from "../canvas/store";
import { boardCentre, findFreeSpot } from "../canvas/placement";
import { DEFAULT_SIZE, type Block } from "../canvas/types";
import { openDocument } from "./documentViewerState";
import { Icon } from "../ui/icons";
import { toastError } from "../ui/toast";

/**
 * Everything imported into this workspace, in one place.
 *
 * Documents could only be reached through a doc block before, which made the
 * folder invisible: a file imported and then deleted from the board was still on
 * disk with no way to see or remove it, and re-importing the same paper made a
 * second copy. The workspace folder is the real unit of storage, so it needs a
 * view of its own.
 */
export default function DocumentsPanel({ onClose }: { onClose: () => void }) {
  const { root, id: wsId } = useCurrentWorkspace();
  const run = useBoard((s) => s.run);

  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!root || !wsId) return;
    try {
      setDocs(await listDocuments(root, wsId));
    } catch (e) {
      toastError(e);
    }
  }, [root, wsId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function importFiles() {
    if (!root || !wsId) return;
    setBusy(true);
    try {
      const picked = await open({
        multiple: true,
        filters: [
          { name: "Documents", extensions: ["pdf", "docx", "md", "markdown", "txt", "csv"] },
        ],
      });
      const paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
      for (const path of paths) {
        await importDocument(root, wsId, path);
      }
      await refresh();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove(file: string) {
    if (!root || !wsId) return;
    try {
      await deleteDocument(root, wsId, file);
      setConfirming(null);
      await refresh();
    } catch (e) {
      toastError(e);
    }
  }

  /** Put a card for this document on the board, already pointing at the file. */
  function addToBoard(doc: DocumentInfo) {
    const board = useBoard.getState().board;
    const size = DEFAULT_SIZE.doc;
    const pos = findFreeSpot(board, size, boardCentre(board));
    run(
      {
        t: "addBlock",
        block: {
          id: `doc-${nanoid(8)}`,
          type: "doc",
          position: pos,
          width: size.width,
          height: size.height,
          zIndex: 1,
          data: { title: doc.file.replace(/\.[^.]+$/, ""), file: doc.file },
        } as Block,
      },
      "user",
    );
    onClose();
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 120,
        background: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxWidth: "100%",
          height: "100%",
          background: "var(--surface)",
          borderLeft: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "14px 16px",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <h2 style={{ fontSize: 15, margin: 0, fontWeight: 600, flex: 1 }}>Documents</h2>
          <button
            onClick={() => void importFiles()}
            disabled={busy}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 12px",
              borderRadius: "var(--r-sm)",
              fontSize: 13,
              background: "var(--accent)",
              color: "var(--on-accent)",
            }}
          >
            <Icon name="add" size={13} /> {busy ? "Importing…" : "Import"}
          </button>
          <button
            onClick={onClose}
            title="Close"
            style={{ display: "grid", placeItems: "center", color: "var(--text-muted)" }}
          >
            <Icon name="close" size={17} />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
          {docs.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "60px 16px",
                color: "var(--text-faint)",
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              Nothing imported yet. PDFs, Word files, Markdown and plain text are
              copied into this workspace's folder, so the project stays portable.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {docs.map((d) => (
                <div
                  key={d.file}
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--r-md)",
                    padding: "10px 12px",
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      overflowWrap: "anywhere",
                      marginBottom: 2,
                    }}
                  >
                    {d.file}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 9 }}>
                    {(d.kind || "file").toUpperCase()} · {Math.max(1, Math.round(d.sizeBytes / 1024))} KB
                  </div>

                  {confirming === d.file ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, color: "var(--text-muted)", flex: 1 }}>
                        Delete this file from disk?
                      </span>
                      <button
                        onClick={() => setConfirming(null)}
                        style={{ fontSize: 12, color: "var(--text-muted)" }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => void remove(d.file)}
                        style={{ fontSize: 12, color: "var(--danger)", fontWeight: 500 }}
                      >
                        Delete
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => openDocument(d.file, d.file)}
                        style={{
                          padding: "5px 10px",
                          borderRadius: "var(--r-sm)",
                          border: "1px solid var(--border)",
                          fontSize: 12,
                        }}
                      >
                        Read
                      </button>
                      <button
                        onClick={() => addToBoard(d)}
                        style={{
                          padding: "5px 10px",
                          borderRadius: "var(--r-sm)",
                          border: "1px solid var(--border)",
                          fontSize: 12,
                        }}
                      >
                        Add to board
                      </button>
                      <button
                        onClick={() => setConfirming(d.file)}
                        title="Delete from disk"
                        style={{
                          marginLeft: "auto",
                          display: "grid",
                          placeItems: "center",
                          width: 26,
                          color: "var(--text-faint)",
                        }}
                      >
                        <Icon name="trash" size={13} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            padding: "10px 16px",
            borderTop: "1px solid var(--border)",
            fontSize: 11,
            color: "var(--text-faint)",
            lineHeight: 1.5,
          }}
        >
          Deleting a file here removes it from disk. Any doc block still pointing at
          it will show that it could not be found.
        </div>
      </div>
    </div>
  );
}
