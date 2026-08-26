import { nanoid } from "nanoid";
import type { ToolCall, ToolResult, ToolSpec } from "../providers/types";
import type { Command } from "../canvas/commands";
import { useBoard } from "../canvas/store";
import { boardCentre, boundsOf, findFreeSpot } from "../canvas/placement";
import { isSparse } from "../canvas/serialize";
import { DEFAULT_SIZE, type Block, type XY } from "../canvas/types";
import { useCurrentWorkspace } from "../workspace/current";
import { listDocuments, readDocumentText } from "../workspace/api";
import { SOURCES, formatPaper, searchPapers, type Source } from "./research";

/**
 * The assistant's vocabulary.
 *
 * Every tool here resolves to a `Command`, the same union the UI uses — which is
 * what keeps agent edits and user edits on one undo stack and stops the two from
 * drifting apart. Tools never touch the board directly.
 */

/**
 * How much of a document goes into one tool result.
 *
 * Roughly 30k tokens of English. Large enough for a normal paper, small enough
 * that a 300-page PDF cannot evict the conversation and the board state around it.
 */
const DOC_CHAR_LIMIT = 120_000;

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
    name: "list_documents",
    description:
      "List the documents the user has imported into this workspace. Call this before answering " +
      "anything that might depend on their own material — you cannot see the documents folder " +
      "otherwise, and guessing at a paper you have not read is worse than asking.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "read_document",
    description:
      "Read an imported document's full text. Use the exact file name from list_documents. " +
      "Long documents are truncated, and you are told when that happens — say so rather than " +
      "implying you read the whole thing.",
    parameters: {
      type: "object",
      properties: {
        file: str("File name exactly as returned by list_documents, e.g. paper.pdf."),
      },
      required: ["file"],
    },
  },
  {
    name: "search_papers",
    description:
      "Search the academic literature. Free and needs no key. Sources are different corpora, not " +
      "mirrors: arxiv is preprints, pubmed is biomedical, openalex is the broad index, " +
      "semanticscholar carries abstracts and citation counts. Use 'all' unless the user named a " +
      "source. This returns metadata and abstracts, not full text — do not claim to have read a " +
      "paper you have only seen the abstract of.",
    parameters: {
      type: "object",
      properties: {
        query: str("What to search for. Keywords work better than a full sentence."),
        source: {
          type: "string",
          enum: [...SOURCES, "all"],
          description: "Which corpus to search. Defaults to all.",
        },
        limit: num("How many results per source, 1 to 25. Defaults to 8."),
      },
      required: ["query"],
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

      case "list_documents": {
        const { root, id: wsId } = useCurrentWorkspace.getState();
        if (!root || !wsId) return fail(call.id, "No workspace is open.");
        const docs = await listDocuments(root, wsId);
        if (docs.length === 0) {
          return ok(call.id, "No documents have been imported into this workspace yet.");
        }
        return ok(
          call.id,
          docs.map((d) => `${d.file} (${d.kind || "unknown"}, ${Math.round(d.sizeBytes / 1024)} KB)`).join("\n"),
        );
      }

      case "read_document": {
        const { root, id: wsId } = useCurrentWorkspace.getState();
        if (!root || !wsId) return fail(call.id, "No workspace is open.");
        const file = String(a.file ?? "");
        if (!file) return fail(call.id, "Which document? Pass a file name from list_documents.");

        const text = await readDocumentText(root, wsId, file);
        if (!text.trim()) {
          return fail(
            call.id,
            `${file} has no extractable text — it may be a scanned PDF, which would need OCR.`,
          );
        }
        // Spec G puts whole documents in context, but one oversized paper should
        // not evict the rest of the conversation. Truncation is disclosed in the
        // result so the model can tell the user rather than quietly summarising a
        // fraction as though it were the whole.
        if (text.length > DOC_CHAR_LIMIT) {
          return ok(
            call.id,
            `${text.slice(0, DOC_CHAR_LIMIT)}\n\n[Truncated: showing the first ${DOC_CHAR_LIMIT} of ` +
              `${text.length} characters of ${file}. Tell the user this is a partial read.]`,
          );
        }
        return ok(call.id, text);
      }

      case "search_papers": {
        const query = String(a.query ?? "").trim();
        if (!query) return fail(call.id, "What should I search for?");
        const source = (
          typeof a.source === "string" && [...SOURCES, "all"].includes(a.source) ? a.source : "all"
        ) as Source | "all";
        const limit = typeof a.limit === "number" ? a.limit : 8;

        const { papers, failed } = await searchPapers(query, source, limit);
        if (papers.length === 0) {
          const why = failed.length
            ? ` Every source queried failed: ${failed.map((f) => `${f.source} (${f.error})`).join(", ")}.`
            : "";
          return fail(call.id, `No results for "${query}".${why}`);
        }

        const body = papers.map(formatPaper).join("\n\n");
        // A partial outage must be visible, or a thin result set reads as "little
        // has been written on this" rather than "two indexes were unreachable".
        const note = failed.length
          ? `\n\n[${failed.map((f) => f.source).join(" and ")} could not be reached, so these results are incomplete.]`
          : "";
        return ok(call.id, `${papers.length} result(s) for "${query}":\n\n${body}${note}`);
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
