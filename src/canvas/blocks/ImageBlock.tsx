import { NodeResizer, type NodeProps } from "@xyflow/react";
import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { BlockShell, NODRAG } from "./common";
import { ConnectHandles } from "./NoteBlock";
import { useBoard } from "../store";
import { useCurrentWorkspace } from "../../workspace/current";
import { importImage, readImageDataUrl } from "../../workspace/api";
import { toastError } from "../../ui/toastStore";
import { Icon } from "../../ui/icons";
import type { ImageBlock as ImageBlockType } from "../types";

/**
 * An image on the board.
 *
 * The file is loaded as a data URL through Rust rather than referenced by path.
 * A file:// URL would not load under the webview's origin, and the asset protocol
 * would mean granting a filesystem scope for something only ever read from inside
 * the workspace folder we already own.
 *
 * Decoded bytes are held in component state, not in the board — board.json is the
 * file format and the assistant's view of the world, and neither wants a
 * megabyte of base64 in it.
 */
export default function ImageBlockView({ id, data, selected }: NodeProps<ImageBlockType>) {
  const run = useBoard((s) => s.run);
  const { root, id: wsId } = useCurrentWorkspace();
  const [src, setSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const file = data.file ?? "";

  useEffect(() => {
    let live = true;
    if (!file || !root || !wsId) {
      setSrc(null);
      return;
    }
    readImageDataUrl(root, wsId, file)
      .then((url) => live && setSrc(url))
      // A missing image is shown as a broken card rather than a toast: it is a
      // property of this block, and one toast per block on load would be noise.
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [file, root, wsId]);

  async function choose() {
    if (!root || !wsId) return;
    setBusy(true);
    try {
      const picked = await open({
        multiple: false,
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"] }],
      });
      if (typeof picked !== "string") return;
      const info = await importImage(root, wsId, picked);
      run({ t: "updateBlock", id, patch: { file: info.file } }, "user");
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <BlockShell id={id} selected={!!selected} marker={data.marker}>
      <NodeResizer
        isVisible={!!selected}
        minWidth={80}
        minHeight={60}
        lineStyle={{ borderColor: "var(--accent-line)" }}
        handleStyle={{
          width: 7,
          height: 7,
          borderRadius: 2,
          background: "var(--accent)",
          border: "1px solid var(--bg)",
        }}
      />
      <ConnectHandles />

      <div className={NODRAG} style={{ flex: 1, minHeight: 0, display: "grid", placeItems: "center" }}>
        {src ? (
          <img
            src={src}
            alt={data.title ?? file}
            draggable={false}
            // contain, so resizing the card never distorts the picture.
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
          />
        ) : file ? (
          <span style={{ fontSize: 12, color: "var(--text-faint)", padding: 10, textAlign: "center" }}>
            Could not load {file}
          </span>
        ) : (
          <button
            onClick={() => void choose()}
            disabled={busy || !root}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "9px 12px",
              borderRadius: "var(--r-sm)",
              border: "1px dashed var(--border-strong)",
              fontSize: 13,
              color: "var(--text-muted)",
            }}
          >
            <Icon name="image" size={14} /> {busy ? "Importing…" : "Choose an image"}
          </button>
        )}
      </div>
    </BlockShell>
  );
}
