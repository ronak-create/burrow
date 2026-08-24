import { produce } from "immer";
import type { Block, Board, BoardEdge, InkStroke, Marker, Size, XY } from "./types";

/**
 * The command layer — the load-bearing file.
 *
 * Every mutation of the board goes through `apply`, whether it came from the UI
 * or from the assistant. Two things fall out of that:
 *
 *   1. One shared undo stack. Ctrl+Z undoes whichever edit happened last,
 *      regardless of who made it (spec C).
 *   2. The assistant's tool vocabulary is generated from this same union, so the
 *      agent can never drift out of sync with what the UI can do.
 *
 * `apply` and `invert` are pure functions over plain JSON, which is why they are
 * cheap to test exhaustively.
 */

/**
 * `index` on the add-style commands exists purely so undo restores an item to the
 * position it held, not the end of the list. Array order is render and z order, so
 * an undo that reorders is a visibly wrong undo. Callers creating new content omit it.
 */
export type Command =
  | { t: "addBlock"; block: Block; index?: number }
  | { t: "updateBlock"; id: string; patch: Record<string, unknown> }
  | { t: "moveBlock"; id: string; position: XY }
  /** A missing width/height means "unset" and clears any explicit size. */
  | { t: "resizeBlock"; id: string; size: Partial<Size> }
  | { t: "removeBlock"; id: string }
  | { t: "connect"; edge: BoardEdge; index?: number }
  | { t: "disconnect"; edgeId: string }
  | { t: "setMarker"; id: string; marker: Marker }
  | { t: "addInk"; stroke: InkStroke; index?: number }
  | { t: "removeInk"; strokeId: string }
  /** Atomic group. Undone as one step — used for frame creation, agent multi-edits, frame drags. */
  | { t: "batch"; label: string; commands: Command[] };

export type Origin = "user" | "agent";

/** Human-readable label for the undo UI and the transcript. */
export function describe(cmd: Command): string {
  switch (cmd.t) {
    case "addBlock":
      return `add ${cmd.block.type}`;
    case "updateBlock":
      return `edit block`;
    case "moveBlock":
      return `move block`;
    case "resizeBlock":
      return `resize block`;
    case "removeBlock":
      return `delete block`;
    case "connect":
      return `connect blocks`;
    case "disconnect":
      return `disconnect blocks`;
    case "setMarker":
      return cmd.marker ? `flag block` : `clear flag`;
    case "addInk":
      return `draw`;
    case "removeInk":
      return `erase`;
    case "batch":
      return cmd.label;
  }
}

/** Apply a command. Pure: returns a new board, never mutates the input. */
export function apply(board: Board, cmd: Command): Board {
  return produce(board, (d) => {
    applyInPlace(d as Board, cmd);
  });
}

/** Insert at `index` when given (undo restoring a position), else append. */
function insertAt<T>(list: T[], item: T, index?: number): void {
  if (index !== undefined && index >= 0 && index <= list.length) list.splice(index, 0, item);
  else list.push(item);
}

function applyInPlace(d: Board, cmd: Command): void {
  switch (cmd.t) {
    case "addBlock": {
      // Idempotent on id so a retried agent tool call can't duplicate a block.
      if (!d.nodes.some((n) => n.id === cmd.block.id)) {
        insertAt(d.nodes, cmd.block, cmd.index);
      }
      break;
    }
    case "updateBlock": {
      const n = d.nodes.find((x) => x.id === cmd.id);
      if (!n) break;
      const data = n.data as Record<string, unknown>;
      for (const [k, v] of Object.entries(cmd.patch)) {
        // `undefined` means "absent" throughout the board format, so it deletes.
        if (v === undefined) delete data[k];
        else data[k] = v;
      }
      break;
    }
    case "moveBlock": {
      const n = d.nodes.find((x) => x.id === cmd.id);
      if (n) n.position = { ...cmd.position };
      break;
    }
    case "resizeBlock": {
      const n = d.nodes.find((x) => x.id === cmd.id);
      if (!n) break;
      // undefined means "no explicit size" — clear it rather than writing a zero.
      if (cmd.size.width === undefined) delete n.width;
      else n.width = cmd.size.width;
      if (cmd.size.height === undefined) delete n.height;
      else n.height = cmd.size.height;
      break;
    }
    case "removeBlock": {
      d.nodes = d.nodes.filter((n) => n.id !== cmd.id);
      // Edges cannot outlive either endpoint.
      d.edges = d.edges.filter((e) => e.source !== cmd.id && e.target !== cmd.id);
      break;
    }
    case "connect": {
      if (!d.edges.some((e) => e.id === cmd.edge.id)) insertAt(d.edges, cmd.edge, cmd.index);
      break;
    }
    case "disconnect": {
      d.edges = d.edges.filter((e) => e.id !== cmd.edgeId);
      break;
    }
    case "setMarker": {
      const n = d.nodes.find((x) => x.id === cmd.id);
      if (!n) break;
      const data = n.data as Record<string, unknown>;
      if (cmd.marker === null) delete data.marker;
      else data.marker = cmd.marker;
      break;
    }
    case "addInk": {
      if (!d.ink.some((s) => s.id === cmd.stroke.id)) insertAt(d.ink, cmd.stroke, cmd.index);
      break;
    }
    case "removeInk": {
      d.ink = d.ink.filter((s) => s.id !== cmd.strokeId);
      break;
    }
    case "batch": {
      for (const c of cmd.commands) applyInPlace(d, c);
      break;
    }
  }
}

/**
 * Build the command that exactly undoes `cmd`, given the board *before* it ran.
 * Returns null when the command would be a no-op (e.g. targeting a missing block).
 */
export function invert(board: Board, cmd: Command): Command | null {
  switch (cmd.t) {
    case "addBlock":
      return board.nodes.some((n) => n.id === cmd.block.id)
        ? null // already present; apply was a no-op
        : { t: "removeBlock", id: cmd.block.id };

    case "updateBlock": {
      const n = board.nodes.find((x) => x.id === cmd.id);
      if (!n) return null;
      const data = n.data as Record<string, unknown>;
      const back: Record<string, unknown> = {};
      // Restore exactly the keys this patch touched, and only those.
      for (const k of Object.keys(cmd.patch)) {
        back[k] = k in data ? data[k] : undefined;
      }
      return { t: "updateBlock", id: cmd.id, patch: back };
    }

    case "moveBlock": {
      const n = board.nodes.find((x) => x.id === cmd.id);
      return n ? { t: "moveBlock", id: cmd.id, position: { ...n.position } } : null;
    }

    case "resizeBlock": {
      const n = board.nodes.find((x) => x.id === cmd.id);
      if (!n) return null;
      // Carries undefined through when the block had no explicit size, so undo
      // clears the size rather than pinning it to zero.
      return { t: "resizeBlock", id: cmd.id, size: { width: n.width, height: n.height } };
    }

    case "removeBlock": {
      const index = board.nodes.findIndex((x) => x.id === cmd.id);
      if (index === -1) return null;
      // Removing a block also drops its edges, so the inverse must restore both —
      // each at the index it held, so undo cannot silently reorder the board.
      const restore: Command[] = [
        { t: "addBlock", block: structuredClone(board.nodes[index]), index },
      ];
      board.edges.forEach((e, i) => {
        if (e.source === cmd.id || e.target === cmd.id) {
          restore.push({ t: "connect", edge: structuredClone(e), index: i });
        }
      });
      return { t: "batch", label: "restore block", commands: restore };
    }

    case "connect":
      return board.edges.some((e) => e.id === cmd.edge.id)
        ? null
        : { t: "disconnect", edgeId: cmd.edge.id };

    case "disconnect": {
      const i = board.edges.findIndex((x) => x.id === cmd.edgeId);
      return i === -1 ? null : { t: "connect", edge: structuredClone(board.edges[i]), index: i };
    }

    case "setMarker": {
      const n = board.nodes.find((x) => x.id === cmd.id);
      if (!n) return null;
      const prev = (n.data as Record<string, unknown>).marker;
      return { t: "setMarker", id: cmd.id, marker: (prev as Marker) ?? null };
    }

    case "addInk":
      return board.ink.some((s) => s.id === cmd.stroke.id)
        ? null
        : { t: "removeInk", strokeId: cmd.stroke.id };

    case "removeInk": {
      const i = board.ink.findIndex((x) => x.id === cmd.strokeId);
      return i === -1 ? null : { t: "addInk", stroke: structuredClone(board.ink[i]), index: i };
    }

    case "batch": {
      // Each sub-inverse must be computed against the state that sub-command saw,
      // so walk forward accumulating state, then reverse the collected inverses.
      let cursor = board;
      const inverses: Command[] = [];
      for (const c of cmd.commands) {
        const inv = invert(cursor, c);
        if (inv) inverses.push(inv);
        cursor = apply(cursor, c);
      }
      if (inverses.length === 0) return null;
      inverses.reverse();
      return { t: "batch", label: `undo ${cmd.label}`, commands: inverses };
    }
  }
}
