import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { nanoid } from "nanoid";

import {
  deleteDocument,
  deleteImage,
  importDocument,
  importImage,
  listDocuments,
  listImages,
  type DocumentInfo,
} from "../workspace/api";
import { useCurrentWorkspace } from "../workspace/current";
import { useBoard } from "../canvas/store";
import { boardCentre, findFreeSpot } from "../canvas/placement";
import { DEFAULT_SIZE, type Block } from "../canvas/types";
import { openDocument } from "./documentViewerState";
import { Icon } from "../ui/icons";
import { toastError } from "../ui/toastStore";

/** Extensions that land in <workspace>/images/ rather than /documents/. */
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];

type UploadItem = DocumentInfo & { folder: "documents" | "images" };

/**
 * Everything imported into this workspace, in one place.
 *
 * Files could only be reached through a doc or image block before, which made
 * the folder invisible: something imported and then deleted from the board was
 * still on disk with no way to see or remove it, and re-importing the same file
 * made a second copy. The workspace folder is the real unit of storage, so it
 * needs a view of its own — documents and images alike, since both are just
 * files a user brought in.
 */
export default function DocumentsPanel({ onClose }: { onClose: () => void }) {
  const { root, id: wsId } = useCurrentWorkspace();
  const run = useBoard((s) => s.run);

  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<UploadItem | null>(null);

  const refresh = useCallback(async () => {
    if (!root || !wsId) return;
    try {
      const [docs, images] = await Promise.all([listDocuments(root, wsId), listImages(root, wsId)]);
      setItems([
        ...docs.map((d): UploadItem => ({ ...d, folder: "documents" })),
        ...images.map((d): UploadItem => ({ ...d, folder: "images" })),
      ]);
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
          {
            name: "Files",
            extensions: ["pdf", "docx", "md", "markdown", "txt", "csv", ...IMAGE_EXTENSIONS],
          },
        ],
      });
      const paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
      for (const path of paths) {
        const ext = path.split(".").pop()?.toLowerCase() ?? "";
        if (IMAGE_EXTENSIONS.includes(ext)) await importImage(root, wsId, path);
        else await importDocument(root, wsId, path);
      }
      await refresh();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: UploadItem) {
    if (!root || !wsId) return;
    try {
      if (item.folder === "images") await deleteImage(root, wsId, item.file);
      else await deleteDocument(root, wsId, item.file);
      setConfirming(null);
      await refresh();
    } catch (e) {
      toastError(e);
    }
  }

  /** Put a card for this file on the board, already pointing at it. */
  function addToBoard(item: UploadItem) {
    const board = useBoard.getState().board;
    const kind = item.folder === "images" ? "image" : "doc";
    const size = DEFAULT_SIZE[kind];
    const pos = findFreeSpot(board, size, boardCentre(board));
    run(
      {
        t: "addBlock",
        block: {
          id: `${kind}-${nanoid(8)}`,
          type: kind,
          position: pos,
          width: size.width,
          height: size.height,
          zIndex: 1,
          data: { title: item.file.replace(/\.[^.]+$/, ""), file: item.file },
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
          <h2 style={{ fontSize: 15, margin: 0, fontWeight: 600, flex: 1 }}>Files</h2>
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
          {items.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "60px 16px",
                color: "var(--text-faint)",
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              Nothing imported yet. PDFs, Word files, Markdown, plain text and images
              are copied into this workspace's folder, so the project stays portable.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((d) => (
                <div
                  key={`${d.folder}/${d.file}`}
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

                  {confirming === d ? (
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
                        onClick={() => void remove(d)}
                        style={{ fontSize: 12, color: "var(--danger)", fontWeight: 500 }}
                      >
                        Delete
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 6 }}>
                      {d.folder === "documents" && (
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
                      )}
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
                        onClick={() => setConfirming(d)}
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
