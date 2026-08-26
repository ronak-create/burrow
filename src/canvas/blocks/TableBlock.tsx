import { NodeResizer, type NodeProps } from "@xyflow/react";
import { useCallback, useRef } from "react";
import { BlockShell, NODRAG, NOWHEEL, titleInputStyle, useInlineEdit } from "./common";
import { ConnectHandles } from "./NoteBlock";
import { useBoard } from "../store";
import type { TableBlock as TableBlockType } from "../types";

/**
 * A comparison grid — the "Redis vs Memcached" table of spec H.
 *
 * Deliberately not a spreadsheet: no formulas, no computed columns, no cell
 * references. The value here is putting two things side by side and colouring the
 * cells that matter, which is a different job from calculating.
 *
 * Editing follows the same rule as every other block: keystrokes apply transiently
 * and one history entry is recorded on blur, so a cell edit is one Ctrl+Z rather
 * than one per character. Because `columns` and `rows` are arrays, the patch
 * replaces the whole array — the command layer merges patches into `data`, it does
 * not reach inside them.
 */

/** Editing any part of an array field: snapshot on focus, record the whole array on blur. */
function useGridEdit<T>(id: string, key: "columns" | "rows", current: T) {
  const applyTransient = useBoard((s) => s.applyTransient);
  const record = useBoard((s) => s.record);
  const before = useRef<T | null>(null);

  const onFocus = useCallback(() => {
    // Structured clone: the snapshot must not alias the array we are about to edit.
    before.current = JSON.parse(JSON.stringify(current)) as T;
  }, [current]);

  const change = useCallback(
    (next: T) => applyTransient({ t: "updateBlock", id, patch: { [key]: next } }),
    [applyTransient, id, key],
  );

  const onBlur = useCallback(
    (next: T) => {
      const prev = before.current;
      before.current = null;
      if (prev === null || JSON.stringify(prev) === JSON.stringify(next)) return;
      record(
        { t: "updateBlock", id, patch: { [key]: next } },
        { t: "updateBlock", id, patch: { [key]: prev } },
        "user",
        "edit table",
      );
    },
    [record, id, key],
  );

  return { onFocus, change, onBlur };
}

const cellStyle = {
  background: "transparent",
  border: "none",
  outline: "none",
  padding: "6px 8px",
  fontSize: 13,
  width: "100%",
  minWidth: 0,
};

export default function TableBlockView({ id, data, selected }: NodeProps<TableBlockType>) {
  const title = useInlineEdit(id, "title");
  const record = useBoard((s) => s.record);

  const columns = data.columns ?? [];
  const rows = data.rows ?? [];

  const cols = useGridEdit(id, "columns", columns);
  const cells = useGridEdit(id, "rows", rows);

  /** Structural edits are single, immediately-undoable steps — no focus session. */
  const structural = useCallback(
    (patch: Record<string, unknown>, inverse: Record<string, unknown>, label: string) =>
      record(
        { t: "updateBlock", id, patch },
        { t: "updateBlock", id, patch: inverse },
        "user",
        label,
      ),
    [record, id],
  );

  const addRow = () =>
    structural(
      { rows: [...rows, columns.map(() => "")] },
      { rows },
      "add row",
    );

  const addColumn = () =>
    structural(
      {
        columns: [...columns, `Column ${String.fromCharCode(65 + columns.length)}`],
        rows: rows.map((r) => [...r, ""]),
      },
      { columns, rows },
      "add column",
    );

  const removeRow = (i: number) =>
    structural({ rows: rows.filter((_, n) => n !== i) }, { rows }, "remove row");

  return (
    <BlockShell id={id} selected={!!selected} marker={data.marker}>
      <NodeResizer
        isVisible={!!selected}
        minWidth={260}
        minHeight={140}
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
        placeholder="Untitled table"
        value={data.title ?? ""}
        onFocus={title.onFocus}
        onChange={title.onChange}
        onBlur={title.onBlur}
      />

      <div className={`${NODRAG} ${NOWHEEL}`} style={{ flex: 1, overflow: "auto", padding: "0 8px 8px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <thead>
            <tr>
              {columns.map((c, ci) => (
                <th
                  key={ci}
                  style={{
                    borderBottom: "1px solid var(--border-strong)",
                    padding: 0,
                    textAlign: "left",
                  }}
                >
                  <input
                    className="selectable"
                    style={{ ...cellStyle, fontWeight: 600 }}
                    value={c}
                    onFocus={cols.onFocus}
                    onChange={(e) => {
                      const next = [...columns];
                      next[ci] = e.target.value;
                      cols.change(next);
                    }}
                    onBlur={() => cols.onBlur(columns)}
                  />
                </th>
              ))}
              {/* Row-delete gutter, sized to the button so headers stay aligned. */}
              <th style={{ width: 22, borderBottom: "1px solid var(--border-strong)" }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {columns.map((_, ci) => {
                  const tint = data.cellColors?.[`${ri},${ci}`];
                  return (
                    <td
                      key={ci}
                      style={{
                        borderBottom: "1px solid var(--border)",
                        padding: 0,
                        background: tint ? "var(--accent-wash)" : "transparent",
                      }}
                    >
                      <input
                        className="selectable"
                        style={cellStyle}
                        value={row[ci] ?? ""}
                        onFocus={cells.onFocus}
                        onChange={(e) => {
                          const next = rows.map((r) => [...r]);
                          while (next[ri].length < columns.length) next[ri].push("");
                          next[ri][ci] = e.target.value;
                          cells.change(next);
                        }}
                        onBlur={() => cells.onBlur(rows)}
                      />
                    </td>
                  );
                })}
                <td style={{ borderBottom: "1px solid var(--border)", textAlign: "center" }}>
                  <button
                    onClick={() => removeRow(ri)}
                    title="Remove row"
                    style={{ color: "var(--text-faint)", fontSize: 13, padding: "0 4px" }}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: "flex", gap: 6, paddingTop: 6 }}>
          <button onClick={addRow} style={{ fontSize: 12, color: "var(--text-muted)" }}>
            + Row
          </button>
          <button onClick={addColumn} style={{ fontSize: 12, color: "var(--text-muted)" }}>
            + Column
          </button>
        </div>
      </div>
    </BlockShell>
  );
}
