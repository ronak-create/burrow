import { useEffect, useState } from "react";
import WorkspaceBrowser from "./screens/WorkspaceBrowser";
import CanvasScreen from "./screens/CanvasScreen";
import { useBoard } from "./canvas/store";
import {
  defaultWorkspacesRoot,
  readBoard,
  updateWorkspaceMeta,
  type WorkspaceMeta,
} from "./workspace/api";
import { emptyBoard } from "./canvas/types";
import { seedGettingStarted } from "./workspace/gettingStarted";
import { Toasts } from "./ui/toast";

/**
 * Two screens, no router: a workspace list and an open board. Opening a workspace
 * loads its board.json from disk into the store, which clears history — you cannot
 * undo across a file load.
 */
export default function App() {
  const [root, setRoot] = useState<string | null>(null);
  const [open, setOpen] = useState<WorkspaceMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useBoard((s) => s.load);

  useEffect(() => {
    defaultWorkspacesRoot()
      .then(async (r) => {
        // Seeding is best-effort and never throws, so a failed tutorial write
        // cannot stop the app from reaching the workspace list.
        await seedGettingStarted(r);
        setRoot(r);
      })
      .catch((e) => setError(String(e)));
  }, []);

  async function openWorkspace(ws: WorkspaceMeta) {
    if (!root) return;
    try {
      const board = await readBoard(root, ws.id);
      load({ ...emptyBoard(), ...board });
      await updateWorkspaceMeta(root, ws.id, { touch: true });
      setOpen(ws);
    } catch (e) {
      setError(String(e));
    }
  }

  function closeWorkspace() {
    setOpen(null);
    load(emptyBoard());
  }

  if (error) {
    return (
      <div style={{ padding: 40, maxWidth: 640, margin: "0 auto" }}>
        <h2 style={{ fontSize: 17 }}>Could not start</h2>
        <pre
          className="selectable"
          style={{
            color: "var(--danger)",
            fontSize: 13,
            fontFamily: "var(--font-mono)",
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </pre>
      </div>
    );
  }

  if (!root) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--text-faint)" }}>
        Loading…
      </div>
    );
  }

  return (
    <>
      {open ? (
        <CanvasScreen ws={open} root={root} onBack={closeWorkspace} />
      ) : (
        <WorkspaceBrowser root={root} onOpen={openWorkspace} />
      )}
      <Toasts />
    </>
  );
}
