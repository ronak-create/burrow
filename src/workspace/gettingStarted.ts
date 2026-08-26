import type { Block, Board } from "../canvas/types";
import { emptyBoard } from "../canvas/types";
import { createWorkspace, writeBoard, type WorkspaceMeta } from "./api";

/**
 * The Getting Started workspace.
 *
 * Seeded once, on first launch, as a real workspace on disk rather than a special
 * case in the browser — so it can be opened, edited, drawn on and deleted like any
 * other board. That is the point: the tutorial is itself a worked example of the
 * thing it describes, and nothing in the app needs to know it is special.
 *
 * Deleting it is permanent. The seed is guarded by a localStorage flag rather than
 * by "does this folder exist", so removing it does not make it reappear next launch.
 */

const SEEDED_KEY = "burrow.seededGettingStarted";
export const GETTING_STARTED_NAME = "Getting Started";

function note(
  id: string,
  x: number,
  y: number,
  title: string,
  body: string,
  size?: { width: number; height: number },
): Block {
  return {
    id,
    type: "note",
    position: { x, y },
    data: { title, body },
    ...(size ? { width: size.width, height: size.height } : {}),
  } as Block;
}

/** The tutorial content, laid out in two labelled columns. */
function tutorialBoard(): Board {
  const nodes: Block[] = [
    {
      id: "gs-frame-basics",
      type: "frame",
      position: { x: 0, y: 0 },
      width: 620,
      height: 700,
      data: {
        label: "Start here",
        contains: ["gs-welcome", "gs-canvas", "gs-ink", "gs-undo"],
      },
    } as Block,
    {
      id: "gs-frame-assistant",
      type: "frame",
      position: { x: 680, y: 0 },
      width: 620,
      height: 700,
      data: {
        label: "The assistant",
        contains: ["gs-keys", "gs-voice", "gs-ask", "gs-files"],
      },
    } as Block,

    note(
      "gs-welcome",
      40,
      60,
      "Welcome to Burrow",
      "This is a research board: an infinite canvas you think on, with an assistant you can talk to.\n\nEverything here is a normal workspace. Edit these notes, drag them around, or delete the whole thing once you are done — nothing depends on it.",
      { width: 540, height: 190 },
    ),
    note(
      "gs-canvas",
      40,
      270,
      "The canvas",
      "Use the toolbar at the bottom to add notes, text, boxes and frames.\n\n• Drag on empty space to pan, scroll to zoom\n• Drag a block onto a frame to file it there\n• Drag from a block's edge to another to link them",
      { width: 540, height: 190 },
    ),
    note(
      "gs-ink",
      40,
      480,
      "Draw on it",
      "Switch to the Draw tool for freehand ink — the red string of the corkboard. Erase removes whole strokes.\n\nInk sits under the blocks, so you can circle and annotate without getting in the way.",
      { width: 250, height: 180 },
    ),
    note(
      "gs-undo",
      330,
      480,
      "One undo stack",
      "Ctrl+Z undoes the last change, whoever made it — you or the assistant.\n\nThere is no separate history to reason about.",
      { width: 250, height: 180 },
    ),

    note(
      "gs-keys",
      720,
      60,
      "Bring your own keys",
      "Open Settings and add a key for whichever provider you want — Anthropic, OpenAI or Google.\n\nKeys are stored in your operating system's keychain, never in a file, and are sent only to the provider they belong to. With no keys at all, the board still works completely offline.",
      { width: 540, height: 210 },
    ),
    note(
      "gs-voice",
      720,
      290,
      "Talk to it",
      "Hold the mic button and speak, or just type in the assistant panel.\n\nReplies are meant to be short — the detail belongs on the board, not in the conversation.",
      { width: 540, height: 160 },
    ),
    note(
      "gs-ask",
      720,
      470,
      "Ask it to build",
      'Try: "add a note about X", or "add three notes and connect them".\n\nIt only writes to the board when asked, and it will ask before reorganising work you have already done.',
      { width: 250, height: 190 },
    ),
    note(
      "gs-files",
      1010,
      470,
      "It is just files",
      "This workspace is a plain folder on your disk: board.json, documents/, images/, and a text-only transcript.\n\nBack it up or move it like any other folder.",
      { width: 250, height: 190 },
    ),
  ];

  return { ...emptyBoard(), nodes, viewport: { x: 40, y: 30, zoom: 0.72 } };
}

/**
 * Shared across concurrent callers within one session.
 *
 * The localStorage flag alone is not enough: it is only written after the create
 * round-trips to disk, so two calls that start close together both read "not
 * seeded" and both create a workspace. React's StrictMode double-invokes effects
 * in development and reliably produced exactly that — two tutorials, eleven
 * milliseconds apart. Handing every caller the same promise makes the check and
 * the write atomic from the caller's point of view.
 */
let inFlight: Promise<WorkspaceMeta | null> | null = null;

/**
 * Create the Getting Started workspace if this machine has never been seeded.
 * Returns the new workspace, or null when there was nothing to do. Never throws —
 * a tutorial that fails to write must not stop the app from starting.
 */
export function seedGettingStarted(root: string): Promise<WorkspaceMeta | null> {
  if (localStorage.getItem(SEEDED_KEY)) return Promise.resolve(null);
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const ws = await createWorkspace(root, GETTING_STARTED_NAME, ["guide"], true);
      await writeBoard(root, ws.id, tutorialBoard());
      localStorage.setItem(SEEDED_KEY, "1");
      return ws;
    } catch {
      // Leave the flag unset so the next launch can try again, and clear the
      // guard so a retry within this session is not blocked by the failure.
      inFlight = null;
      return null;
    }
  })();

  return inFlight;
}
