# Burrow

*Dig until you hit the root of it.*

A voice-driven AI research assistant on an infinite canvas — a "digital detective board" for going deep on a topic. Bring your own documents, talk to an assistant that can search, fetch papers, write notes, build diagrams and tables, generate images, and lay it all out on the board with you.

**Local-first and BYOK.** Canvases, documents, and conversation transcripts are plain files on your own disk. You supply your own API keys for whichever providers you want; they are stored in your OS keychain and nothing leaves your machine except the calls you configure.

See [`DESIGN.md`](./DESIGN.md) for the full design, the decisions behind it, and what is deliberately deferred.

## Status

Early. Milestone 1 is a thin end-to-end slice: workspaces on disk, a canvas with note and frame blocks, a unified undo stack, and a voice → assistant → canvas loop.

## Stack

- **Shell** — Tauri v2 (Rust + WebView2/WKWebView). Chosen over a browser app for real filesystem access, OS-keychain key storage, background wake-word listening, and because Tauri's HTTP client is not CORS-bound, which removes the need for any relay proxy.
- **Canvas** — [React Flow](https://github.com/xyflow/xyflow) (`@xyflow/react`), MIT. Every block is a plain React component, and board state *is* `{nodes, edges}` JSON — which doubles as the file format and as the assistant's structured view of the board.
- **Frontend** — React 19 + Vite + TypeScript.

## Requirements

- Node 20+, Rust (stable, MSVC toolchain on Windows), and the platform's webview runtime
- Windows: Visual Studio Build Tools with the C++ workload, plus the WebView2 runtime

## Develop

```bash
npm install
npm run tauri dev     # run the app
npm test              # unit tests (command layer / undo)
npx tsc --noEmit      # type-check
```

Rust-side checks:

```bash
cd src-tauri && cargo check && cargo test
```

## How it is put together

The load-bearing idea is in `src/canvas/commands.ts`: **every** mutation of the board — from the UI and from the assistant alike — goes through a single `apply(board, command)`. That is what makes the undo stack unified (Ctrl+Z undoes whichever edit happened last, no matter who made it), and it means the assistant's tool schemas are generated from the same command union the UI uses, so the two cannot drift apart.

```
src/
  canvas/       command layer, board store, React Flow host, block components
  screens/      workspace browser, canvas screen
  workspace/    workspace file I/O and autosave
src-tauri/src/
  workspace.rs  workspace folders, atomic board writes, transcripts
  keys.rs       BYOK keys in the OS keychain
  speech.rs     OS text-to-speech
```

A workspace is a self-contained folder you own:

```
<Documents>/Burrow/<id>/
  workspace.json     metadata
  board.json         { nodes, edges, ink, viewport }
  transcript.jsonl   append-only, text only — never audio
  documents/
  images/
```

## License

MIT (intended). Every dependency in the canvas stack is permissively licensed so that anyone can clone, run, and self-host this without needing a license of their own.
 