import { NodeResizer, type NodeProps } from "@xyflow/react";
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { BlockShell, NODRAG, titleInputStyle, useInlineEdit } from "./common";
import { ConnectHandles } from "./NoteBlock";
import { useBoard } from "../store";
import { useCurrentWorkspace } from "../../workspace/current";
import { importDocument } from "../../workspace/api";
import { toastError } from "../../ui/toastStore";
import { openDocument } from "../../screens/documentViewerState";
import { Icon } from "../../ui/icons";
import type { DocBlock as DocBlockType } from "../types";

/**
 * A document the user brought in (spec G).
 *
 * The card is a handle, not a reader: PDFs and Word files are long, and rendering
 * one inside a 200px card on an infinite canvas helps nobody. Clicking opens the
 * full reader, which is where excerpting to the board happens.
 *
 * An empty card offers to import. That is deliberate — the block is placed by
 * drawing it like any other, and only then asks what it should hold, so choosing
 * a file and choosing a place stay separate steps.
 */

const KIND_LABEL: Record<string, string> = {
  pdf: "PDF",
  docx: "Word",
  md: "Markdown",
  markdown: "Markdown",
  txt: "Text",
  csv: "CSV",
};

export default function DocBlockView({ id, data, selected }: NodeProps<DocBlockType>) {
  const title = useInlineEdit(id, "title");
  const run = useBoard((s) => s.run);
  const { root, id: wsId } = useCurrentWorkspace();
  const [busy, setBusy] = useState(false);

  const file = data.file ?? "";
  const ext = file.includes(".") ? file.split(".").pop()!.toLowerCase() : "";

  async function choose() {
    if (!root || !wsId) return;
    setBusy(true);
    try {
      const picked = await open({
        multiple: false,
        filters: [
          { name: "Documents", extensions: ["pdf", "docx", "md", "markdown", "txt", "csv"] },
        ],
      });
      if (typeof picked !== "string") return;

      const info = await importDocument(root, wsId, picked);
      // One step: the card gains a file and, if untitled, a name to show.
      run(
        {
          t: "updateBlock",
          id,
          patch: {
            file: info.file,
            ...(data.title ? {} : { title: info.file.replace(/\.[^.]+$/, "") }),
          },
        },
        "user",
      );
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
        minWidth={150}
        minHeight={110}
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

      <input
        className={NODRAG}
        style={titleInputStyle}
        placeholder="Untitled document"
        value={data.title ?? ""}
        onFocus={title.onFocus}
        onChange={title.onChange}
        onBlur={title.onBlur}
      />

      {/*
        A doc card exists to be opened, so opening it is the double click. Every
        other block drills in to be edited on a double click; this one has nothing
        to edit but its title, and reaching the reader used to cost three clicks —
        select, drill in, then press Read. The button stays for discoverability.
      */}
      <div
        className={NODRAG}
        onDoubleClick={() => {
          if (file) openDocument(file, data.title || file);
        }}
        style={{
          flex: 1,
          minHeight: 0,
          padding: "0 14px 14px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          gap: 8,
        }}
      >
        {file ? (
          <>
            <span
              style={{
                fontSize: 12,
                color: "var(--text-faint)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={file}
            >
              {KIND_LABEL[ext] ?? ext.toUpperCase()} · {file}
            </span>
            <button
              onClick={() => openDocument(file, data.title || file)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "7px 10px",
                borderRadius: "var(--r-sm)",
                border: "1px solid var(--border)",
                fontSize: 13,
                color: "var(--text)",
              }}
            >
              <Icon name="doc" size={14} /> Read
            </button>
          </>
        ) : (
          <button
            onClick={() => void choose()}
            disabled={busy || !root}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "9px 10px",
              borderRadius: "var(--r-sm)",
              border: "1px dashed var(--border-strong)",
              fontSize: 13,
              color: "var(--text-muted)",
            }}
          >
            <Icon name="add" size={14} /> {busy ? "Importing…" : "Choose a file"}
          </button>
        )}
      </div>
    </BlockShell>
  );
}
