import { nanoid } from "nanoid";
import type { ToolCall, ToolResult, ToolSpec } from "../providers/types";
import type { Command } from "../canvas/commands";
import { useBoard } from "../canvas/store";
import { boardCentre, boundsOf, findFreeSpot } from "../canvas/placement";
import { isSparse } from "../canvas/serialize";
import { DEFAULT_SIZE, type Block, type XY } from "../canvas/types";

/**
 * The assistant's vocabulary.
 *
 * Every tool here resolves to a `Command`, the same union the UI uses — which is
 * what keeps agent edits and user edits on one undo stack and stops the two from
 * drifting apart. Tools never touch the board directly.
 */

const num = (d: string) => ({ type: "number", description: d });
const str = (d: string) => ({ type: "string", description: d });

export const TOOLS: ToolSpec[] = [
  {
    name: "add_note",
    description:
      "Put a note block on the board. Omit x and y unless the user asked for a specific place — " +
      "leaving them out finds empty space automatically and never covers existing work.",
    parameters: {
      type: "object",
      properties: {
        title: str("Short heading, a few words."),
        body: str("The note's content. Prose, not bullet soup."),
        x: num("Optional canvas x. Omit to auto-place."),
        y: num("Optional canvas y. Omit to auto-place."),
      },
      required: ["title", "body"],
    },
  },
  {
    name: "add_table",
    description:
      "Put a comparison table on the board — the right block whenever the user is weighing options " +
      "against shared criteria. Rows must have exactly one cell per column. This is not a " +
      "spreadsheet: no formulas, no computed columns.",
    parameters: {
      type: "object",
      properties: {
        title: str("Short heading, e.g. Redis vs Memcached."),
        columns: {
          type: "array",
          items: { type: "string" },
          description: "Column headers. The first is usually the criterion being compared.",
        },
        rows: {
          type: "array",
          items: { type: "array", items: { type: "string" } },
          description: "Each row is one array of cell strings, same length as columns.",
        },
        x: num("Optional canvas x. Omit to auto-place."),
        y: num("Optional canvas y. Omit to auto-place."),
      },
      required: ["title", "columns", "rows"],
    },
  },
  {
    name: "add_diagram",
    description:
      "Put a node-and-edge diagram on the board — architectures, pipelines, request flows. " +
      "Describe structure only: layout is computed here, so never reason about coordinates. " +
      "Edges reference node ids, not labels.",
    parameters: {
      type: "object",
      properties: {
        title: str("Short heading, e.g. Write path."),
        nodes: {
          type: "array",
          description: "The boxes.",
          items: {
            type: "object",
            properties: {
              id: str("Short stable id used by edges, e.g. api."),
              label: str("What is shown in the box. Keep it under about 16 characters."),
            },
            required: ["id", "label"],
          },
        },
        edges: {
          type: "array",
          description: "Arrows between nodes. Direction is from -> to.",
          items: {
            type: "object",
            properties: {
              from: str("Source node id."),
              to: str("Target node id."),
              label: str("Optional text on the arrow."),
            },
            required: ["from", "to"],
          },
        },
        x: num("Optional canvas x. Omit to auto-place."),
        y: num("Optional canvas y. Omit to auto-place."),
      },
      required: ["title", "nodes"],
    },
  },
  {
    name: "add_frame",
    description:
      "Draw a labelled frame to group related blocks. If the board already has the user's work on " +
      "it, you must ask permission in conversation first, then call this with userApproved true. " +
      "Framing rearranges someone's thinking — never do it silently.",
    parameters: {
      type: "object",
      properties: {
        label: str("Frame label, e.g. Architecture."),
        around: {
          type: "array",
          items: { type: "string" },
          description: "Block ids to enclose. The frame sizes itself to fit them.",
        },
        userApproved: {
          type: "boolean",
          description: "True only if the user actually agreed to this frame in conversation.",
        },
      },
      required: ["label"],
    },
  },
  {
    name: "update_block",
    description: "Change the text of an existing block.",
    parameters: {
      type: "object",
      properties: {
        id: str("Block id."),
        title: str("New title, if changing it."),
        body: str("New body, if changing it."),
        label: str("New label, for frames."),
      },
      required: ["id"],
    },
  },
  {
    name: "move_block",
    description: "Move a block to a specific spot on the canvas.",
    parameters: {
      type: "object",
      properties: { id: str("Block id."), x: num("Canvas x."), y: num("Canvas y.") },
      required: ["id", "x", "y"],
    },
  },
  {
    name: "delete_block",
    description: "Remove a block. Its connections go with it. Only when the user asks.",
    parameters: {
      type: "object",
      properties: { id: str("Block id.") },
      required: ["id"],
    },
  },
  {
    name: "connect_blocks",
    description: "Draw a connection between two blocks to show a relationship.",
    parameters: {
      type: "object",
      properties: {
        from: str("Source block id."),
        to: str("Target block id."),
        label: str("Optional short label for the relationship, e.g. 'writes to'."),
      },
      required: ["from", "to"],
    },
  },
  {
    name: "flag_block",
    description:
      "Drop a temporary '?' marker on a block you are unsure about, instead of interrupting the " +
      "user to ask. They will address it when they choose. Say what you are unsure about in your reply.",
    parameters: {
      type: "object",
      properties: { id: str("Block id to flag.") },
      required: ["id"],
    },
  },
];

/* ---------- dispatch ---------- */

const ok = (id: string, msg: string): ToolResult => ({ id, content: msg });
const fail = (id: string, msg: string): ToolResult => ({ id, content: msg, isError: true });

/** Where auto-placed content should gravitate: the middle of what the user is looking at. */
function anchor(): XY {
  const { board } = useBoard.getState();
  const { x, y, zoom } = board.viewport;
  if (zoom > 0) {
    return {
      x: (-x + window.innerWidth / 2) / zoom,
      y: (-y + window.innerHeight / 2) / zoom,
    };
  }
  return boardCentre(board);
}

function run(cmd: Command) {
  useBoard.getState().run(cmd, "agent");
}

export async function runTool(call: ToolCall): Promise<ToolResult> {
  const { board } = useBoard.getState();
  const a = call.input;

  try {
    switch (call.name) {
      case "add_note": {
        const size = DEFAULT_SIZE.note;
        const explicit = typeof a.x === "number" && typeof a.y === "number";
        const pos = explicit
          ? { x: a.x as number, y: a.y as number }
          : findFreeSpot(board, size, anchor());
        const id = `note-${nanoid(8)}`;
        run({
          t: "addBlock",
          block: {
            id,
            type: "note",
            position: pos,
            width: size.width,
            height: size.height,
            zIndex: 1,
            data: { title: String(a.title ?? ""), body: String(a.body ?? "") },
          } as Block,
        });
        return ok(call.id, `Added note "${a.title}" (id ${id}) at ${Math.round(pos.x)},${Math.round(pos.y)}.`);
      }

      case "add_table": {
        const columns = (Array.isArray(a.columns) ? a.columns : []).map(String);
        if (columns.length === 0) return fail(call.id, "A table needs at least one column.");
        // Normalise every row to the column count rather than rejecting a ragged
        // one — a model that miscounts should still get a usable table back.
        const rows = (Array.isArray(a.rows) ? a.rows : []).map((r) => {
          const cells = (Array.isArray(r) ? r : []).map(String);
          return columns.map((_, i) => cells[i] ?? "");
        });

        const size = DEFAULT_SIZE.table;
        const explicit = typeof a.x === "number" && typeof a.y === "number";
        const pos = explicit
          ? { x: a.x as number, y: a.y as number }
          : findFreeSpot(board, size, anchor());
        const id = `table-${nanoid(8)}`;
        run({
          t: "addBlock",
          block: {
            id,
            type: "table",
            position: pos,
            width: size.width,
            height: size.height,
            zIndex: 1,
            data: { title: String(a.title ?? ""), columns, rows },
          } as Block,
        });
        return ok(
          call.id,
          `Added table "${a.title}" (id ${id}) with ${columns.length} columns and ${rows.length} rows.`,
        );
      }

      case "add_diagram": {
        const rawNodes = Array.isArray(a.nodes) ? a.nodes : [];
        const nodes = rawNodes
          .map((n) => n as { id?: unknown; label?: unknown })
          .filter((n) => n && n.id !== undefined)
          .map((n) => ({ id: String(n.id), label: String(n.label ?? n.id) }));
        if (nodes.length === 0) return fail(call.id, "A diagram needs at least one node.");

        const known = new Set(nodes.map((n) => n.id));
        const rawEdges = Array.isArray(a.edges) ? a.edges : [];
        const edges = rawEdges
          .map((e) => e as { from?: unknown; to?: unknown; label?: unknown })
          .filter((e) => e && known.has(String(e.from)) && known.has(String(e.to)))
          .map((e) => ({
            from: String(e.from),
            to: String(e.to),
            ...(e.label !== undefined ? { label: String(e.label) } : {}),
          }));
        // Dangling edges would render as nothing, which reads as a silent failure;
        // say so instead, so the model can correct the ids on a later turn.
        const dropped = rawEdges.length - edges.length;

        const size = DEFAULT_SIZE.diagram;
        const explicit = typeof a.x === "number" && typeof a.y === "number";
        const pos = explicit
          ? { x: a.x as number, y: a.y as number }
          : findFreeSpot(board, size, anchor());
        const id = `diagram-${nanoid(8)}`;
        run({
          t: "addBlock",
          block: {
            id,
            type: "diagram",
            position: pos,
            width: size.width,
            height: size.height,
            zIndex: 1,
            data: { title: String(a.title ?? ""), nodes, edges },
          } as Block,
        });
        return ok(
          call.id,
          `Added diagram "${a.title}" (id ${id}) with ${nodes.length} nodes and ${edges.length} edges.` +
            (dropped > 0 ? ` Dropped ${dropped} edge(s) referencing unknown node ids.` : ""),
        );
      }

      case "add_frame": {
        // Spec C: free rein on a sparse board, explicit consent on a populated one.
        if (!isSparse(board) && a.userApproved !== true) {
          return fail(
            call.id,
            "This board already has work on it, so a frame needs the user's agreement first. " +
              "Ask them in your reply, and only call add_frame again once they say yes.",
          );
        }

        const ids = Array.isArray(a.around) ? (a.around as string[]) : [];
        const fitted = ids.length ? boundsOf(board, ids) : null;
        const size = fitted
          ? { width: fitted.width, height: fitted.height }
          : DEFAULT_SIZE.frame;
        const pos = fitted ? { x: fitted.x, y: fitted.y } : findFreeSpot(board, size, anchor());

        const id = `frame-${nanoid(8)}`;
        run({
          t: "addBlock",
          block: {
            id,
            type: "frame",
            position: pos,
            width: size.width,
            height: size.height,
            zIndex: 0,
            // Framing "around" specific blocks is an explicit grouping, so those ids
            // become the frame's members. An empty frame owns nothing.
            data: { label: String(a.label ?? ""), ...(fitted ? { contains: ids } : {}) },
          } as Block,
        });
        return ok(
          call.id,
          fitted
            ? `Framed ${ids.length} block(s) as "${a.label}" (id ${id}).`
            : `Added empty frame "${a.label}" (id ${id}).`,
        );
      }

      case "update_block": {
        const id = String(a.id ?? "");
        if (!board.nodes.some((n) => n.id === id)) return fail(call.id, `No block with id ${id}.`);
        const patch: Record<string, unknown> = {};
        for (const k of ["title", "body", "label"] as const) {
          if (typeof a[k] === "string") patch[k] = a[k];
        }
        if (!Object.keys(patch).length) return fail(call.id, "Nothing to update.");
        run({ t: "updateBlock", id, patch });
        return ok(call.id, `Updated ${id}.`);
      }

      case "move_block": {
        const id = String(a.id ?? "");
        if (!board.nodes.some((n) => n.id === id)) return fail(call.id, `No block with id ${id}.`);
        run({ t: "moveBlock", id, position: { x: Number(a.x), y: Number(a.y) } });
        return ok(call.id, `Moved ${id}.`);
      }

      case "delete_block": {
        const id = String(a.id ?? "");
        if (!board.nodes.some((n) => n.id === id)) return fail(call.id, `No block with id ${id}.`);
        run({ t: "removeBlock", id });
        return ok(call.id, `Deleted ${id}.`);
      }

      case "connect_blocks": {
        const from = String(a.from ?? "");
        const to = String(a.to ?? "");
        if (!board.nodes.some((n) => n.id === from)) return fail(call.id, `No block with id ${from}.`);
        if (!board.nodes.some((n) => n.id === to)) return fail(call.id, `No block with id ${to}.`);
        if (from === to) return fail(call.id, "A block cannot connect to itself.");
        run({
          t: "connect",
          edge: {
            id: `e-${nanoid(8)}`,
            source: from,
            target: to,
            type: "floating",
            ...(typeof a.label === "string" && a.label ? { label: a.label } : {}),
          },
        });
        return ok(call.id, `Connected ${from} → ${to}.`);
      }

      case "flag_block": {
        const id = String(a.id ?? "");
        if (!board.nodes.some((n) => n.id === id)) return fail(call.id, `No block with id ${id}.`);
        run({ t: "setMarker", id, marker: "?" });
        return ok(call.id, `Flagged ${id} for the user to look at.`);
      }

      default:
        return fail(call.id, `Unknown tool ${call.name}.`);
    }
  } catch (e) {
    return fail(call.id, `Tool ${call.name} failed: ${e}`);
  }
}
