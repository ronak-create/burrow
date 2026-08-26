# Burrow

*Dig until you hit the root of it.*

A voice-driven AI research assistant on an infinite canvas — a "digital detective board" for going deep on a topic. Bring your own documents, talk to an assistant that can search, fetch papers, write notes, build diagrams and tables, generate images, and lay it all out on the board with you.

**Local-first and BYOK.** Canvases, documents, and conversation transcripts are plain files on your own disk. You supply your own API keys for whichever providers you want; they are stored in your OS keychain and nothing leaves your machine except the calls you configure.

See [`DESIGN.md`](./DESIGN.md) for the full design, the decisions behind it, and what is deliberately deferred.

## Status

Usable, and free to run. The assistant loop is verified against live providers,
every block type in the toolbar is real, documents can be imported and read, and
papers can be searched across four open indexes.

**Working**

- Workspaces as plain folders on disk, pinnable, with global search across every
  board and transcript
- Canvas with note, text, shape, frame, table, diagram, doc and image blocks —
  drawn onto the canvas rather than dropped at the viewport centre
- Freehand ink and eraser, and one undo stack shared by you and the assistant
- Assistant with eleven tools: write blocks, connect them, frame them, read your
  documents, search the literature
- Documents: PDF, Word, Markdown and text imported into the workspace, read
  in-app, and excerpted onto the board
- BYOK keys in the OS keychain, or **no keys at all** — point it at Ollama or any
  OpenAI-compatible endpoint and the whole thing runs locally
- Light/dark, monochrome by default, with an optional accent

**Not built yet**

- Wake word and always-on listening. Voice input works today as hold-to-talk;
  true background listening needs a dedicated wake-word engine.
- Local speech-to-text. Transcription still needs a key (Groq, OpenAI or
  Deepgram); the zero-key path is local Whisper and is not bundled.
- Image generation.

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

`npm run dev` alone serves the frontend but cannot run the app: the workspace
layer calls into Rust, which only exists inside the Tauri shell. In a browser tab
the first call fails with `Cannot read properties of undefined (reading 'invoke')`.

**Running with no API key.** Install [Ollama](https://ollama.com), pull a model
that supports tool calling, and Burrow will find it — Settings defaults to
`http://127.0.0.1:11434/v1`, and **Detect** lists what you have. A model without
tool-calling support can hold a conversation but cannot touch the board.

Rust-side checks:

```bash
cd src-tauri && cargo check && cargo test
```

## How it is put together

The load-bearing idea is in `src/canvas/commands.ts`: **every** mutation of the board — from the UI and from the assistant alike — goes through a single `apply(board, command)`. That is what makes the undo stack unified (Ctrl+Z undoes whichever edit happened last, no matter who made it), and it means the assistant's tool schemas are generated from the same command union the UI uses, so the two cannot drift apart.

```
src/
  agent/        the assistant loop, its tools, and paper search
  canvas/       command layer, board store, React Flow host, block components
  providers/    LLM and speech-to-text adapters, and the provider registry
  screens/      workspace browser, canvas, settings, document reader
  workspace/    workspace file I/O and autosave
src-tauri/src/
  workspace.rs  workspace folders, atomic board writes, transcripts, search
  documents.rs  document import and text extraction (PDF, Word, Markdown)
  keys.rs       BYOK keys in the OS keychain
  speech.rs     OS text-to-speech
```

Providers are a factory, not a file each: `providers/llm/openai.ts` exports
`openAICompatible({url, models})`, and OpenAI, Groq, Cerebras and the custom
endpoint are all configuration over it. Adding another compatible gateway is a
config object.

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
 