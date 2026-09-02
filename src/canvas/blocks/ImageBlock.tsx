import { NodeResizer, type NodeProps } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { BlockShell, NODRAG } from "./common";
import { useActiveBlock } from "./common";
import { ConnectHandles } from "./NoteBlock";
import { useBoard } from "../store";
import { useCurrentWorkspace } from "../../workspace/current";
import { importImage, readImageDataUrl } from "../../workspace/api";
import { toastError } from "../../ui/toastStore";
import { Icon } from "../../ui/icons";
import type { ImageBlock as ImageBlockType, ImageData } from "../types";

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
 *
 * Framing (`data.crop`) is a description, not an edit: the picture is re-framed
 * by CSS on every render and the file on disk is never touched. On a research
 * board that is the only defensible choice — the image is usually a figure out of
 * someone else's paper, and cropping the evidence to make a point is a different
 * act from cropping the view of it.
 */
const DEFAULT_CROP = { zoom: 1, x: 50, y: 50 };
const MAX_ZOOM = 4;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export default function ImageBlockView({ id, data, selected }: NodeProps<ImageBlockType>) {
  const run = useBoard((s) => s.run);
  const applyTransient = useBoard((s) => s.applyTransient);
  const record = useBoard((s) => s.record);
  const { root, id: wsId } = useCurrentWorkspace();
  const [src, setSrc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Adjusting happens inside a drilled-in block, like every other kind of editing
  // on this canvas: one click selects, two gets you into it.
  const active = useActiveBlock((s) => s.activeId) === id;

  const frameRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ x: number; y: number; from: ImageData["crop"] } | null>(null);

  const file = data.file ?? "";
  const crop = data.crop;
  const zoom = crop?.zoom ?? 1;
  const px = crop?.x ?? 50;
  const py = crop?.y ?? 50;

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

  const setCrop = (next: ImageData["crop"]) =>
    run({ t: "updateBlock", id, patch: { crop: next } }, "user");

  /**
   * How far the picture overhangs the card, in pixels.
   *
   * Panning has to move the picture, not a percentage: dragging an inch should
   * move what you see by an inch whether the overhang is 30px or 3000. That
   * needs the natural size, which is only known once the image has decoded.
   */
  function overhang() {
    const img = imgRef.current;
    const frame = frameRef.current;
    if (!img || !frame || !img.naturalWidth || !img.naturalHeight) return null;
    const fw = frame.clientWidth;
    const fh = frame.clientHeight;
    const cover = Math.max(fw / img.naturalWidth, fh / img.naturalHeight) * zoom;
    return {
      x: Math.max(0, img.naturalWidth * cover - fw),
      y: Math.max(0, img.naturalHeight * cover - fh),
    };
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!active || !crop) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, from: { ...crop } };
  }

  function onPointerMove(e: React.PointerEvent) {
    const start = drag.current;
    if (!start || !start.from) return;
    const over = overhang();
    if (!over) return;

    // Dragging right reveals what is to the left, so the percentage falls.
    const dx = over.x ? ((e.clientX - start.x) / over.x) * 100 : 0;
    const dy = over.y ? ((e.clientY - start.y) / over.y) * 100 : 0;

    applyTransient({
      t: "updateBlock",
      id,
      patch: {
        crop: {
          zoom: start.from.zoom,
          x: clamp(start.from.x - dx, 0, 100),
          y: clamp(start.from.y - dy, 0, 100),
        },
      },
    });
  }

  function onPointerUp() {
    const start = drag.current;
    drag.current = null;
    if (!start?.from) return;
    const now = (useBoard.getState().board.nodes.find((n) => n.id === id)?.data as ImageData | undefined)
      ?.crop;
    if (!now || (now.x === start.from.x && now.y === start.from.y)) return;

    // One entry for the whole drag, the same bargain node dragging makes: sixty
    // transient updates, one Ctrl+Z.
    record(
      { t: "updateBlock", id, patch: { crop: now } },
      { t: "updateBlock", id, patch: { crop: start.from } },
      "user",
      "adjust image",
    );
  }

  const controlButton = (label: string, onClick: () => void, on = false) => (
    <button
      className={NODRAG}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        padding: "3px 9px",
        borderRadius: "var(--r-sm)",
        fontSize: 12,
        border: `1px solid ${on ? "var(--accent-line)" : "var(--border)"}`,
        background: on ? "var(--accent-wash)" : "var(--surface)",
        color: on ? "var(--text)" : "var(--text-muted)",
      }}
    >
      {label}
    </button>
  );

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

      <div
        ref={frameRef}
        className={NODRAG}
        style={{
          flex: 1,
          minHeight: 0,
          position: "relative",
          overflow: "hidden",
          display: crop ? "block" : "grid",
          placeItems: crop ? undefined : "center",
        }}
      >
        {src ? (
          <img
            ref={imgRef}
            src={src}
            alt={data.title ?? file}
            draggable={false}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{
              width: "100%",
              height: "100%",
              // Without a crop the whole picture fits inside the card, so resizing
              // never distorts or hides anything. With one, the card is a window.
              objectFit: crop ? "cover" : "contain",
              objectPosition: `${px}% ${py}%`,
              ...(zoom !== 1 ? { transform: `scale(${zoom})`, transformOrigin: `${px}% ${py}%` } : {}),
              display: "block",
              cursor: active && crop ? (drag.current ? "grabbing" : "grab") : undefined,
              userSelect: "none",
            }}
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

        {/* Only inside a drilled-in block: the controls are for adjusting this
            picture, and a card you have merely selected is not being adjusted. */}
        {active && src ? (
          <div
            style={{
              position: "absolute",
              left: 8,
              right: 8,
              bottom: 8,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 8px",
              borderRadius: "var(--r-md)",
              background: "color-mix(in srgb, var(--surface) 88%, transparent)",
              border: "1px solid var(--border)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            {controlButton("Fit", () => setCrop(undefined), !crop)}
            {controlButton("Fill", () => setCrop({ ...DEFAULT_CROP }), !!crop)}
            {crop ? (
              <>
                <input
                  className={NODRAG}
                  type="range"
                  min={1}
                  max={MAX_ZOOM}
                  step={0.05}
                  value={zoom}
                  onPointerDown={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    setCrop({ zoom: Number(e.target.value), x: px, y: py })
                  }
                  title="Zoom"
                  style={{ flex: 1, minWidth: 40, accentColor: "var(--accent)" }}
                />
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    color: "var(--text-faint)",
                    minWidth: 30,
                    textAlign: "right",
                  }}
                >
                  {zoom.toFixed(1)}×
                </span>
              </>
            ) : (
              <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
                Fill, then drag the picture to frame it.
              </span>
            )}
          </div>
        ) : null}
      </div>
    </BlockShell>
  );
}
