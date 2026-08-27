# Research Canvas — Design Plan

*A voice-driven AI research assistant on an infinite canvas — a "digital detective board" for going deep on a topic: bring your own documents, talk to an assistant that can search, fetch papers, write notes, build diagrams/tables, generate images, and lay it all out on the board with you.*

---

## Guiding Principles

- **Personal tool first, open-source project second.** Built to solve your own "don't stop until I hit the root of it" research workflow. Once it works well, released as free/open-source so other researchers can use it.
- **No org/industry involvement, no hosted backend.** The project stays out of the billing and liability loop entirely via **BYOK (bring your own key)** — each user supplies their own API keys for whichever providers they want (LLM, voice, search, image-gen), stored only on their own machine.
- **Local-first.** Canvases, workspace files, and conversation transcripts are plain files the user owns on their own disk — not on a server anyone else controls.
- **Web app now, desktop wrapper later.** Same React + canvas-SDK codebase either way — start as a web app for fast iteration and easy open-source adoption, revisit a native Electron/Tauri build once background listening or hosting economics make it necessary.

---

## Design Tree

### A. Scope, Licensing & Distribution
- **Audience**: Personal tool first → released as a free, open-source tool for other researchers. No org/enterprise version planned (multiplayer is *noted* as a possible future paid/industry feature, not built now).
- **License**: Permissive (MIT or Apache-2.0) — matches the canvas SDK's own license, removes friction for adoption, doesn't block a future hosted offering.
- **Monetization**: None at the app level. Users pay their own AI providers directly (BYOK). No accounts, no billing, no server costs to the project.

### B. Platform & Architecture
- ✅ **REVISED (Aug 2026) — Tauri v2 desktop shell from day one**, not web-first. Same React codebase, and it removes three of this document's own listed risks at once: the Chromium-only File System Access API limitation, the focused-window-only wake word, and the local CORS relay proxy. API keys also move to the OS keychain instead of `localStorage`. Cost: users install an app rather than opening a URL. The web-first plan below is superseded but kept for reasoning.
- **v1 platform (superseded)**: Web app (browser), Chromium-first.
  - Local file storage via the browser's **File System Access API** (grants persistent access to a chosen local folder) — Chromium-only (Chrome/Edge/Brave); Firefox/Safari not supported for this feature at launch.
  - Wake-word/voice listening works while the app window is open and focused (true OS-level background listening isn't possible from a browser tab).
- **v2 (future)**: Electron or Tauri desktop wrapper, built on the same codebase, to unlock true background wake-word listening and universal (non-Chromium) file access — revisited once the core assistant+canvas loop is solid, and/or once hosting costs make a desktop-only, zero-server distribution model more attractive.
- ~~**Local proxy for API calls**~~ — ❌ **STRUCK (Aug 2026).** No longer needed. Tauri's HTTP client is not CORS-bound, so provider calls go straight out through `tauri-plugin-http` with no relay process at all. This also means Anthropic's browser-access header is unnecessary, since requests carry no browser `Origin`. Original text: A small local process bundled with the app relays requests to AI providers (Anthropic, OpenAI, ElevenLabs, image-gen APIs, etc.) from day one. This isn't a hosted backend — it runs entirely on the user's own machine — it just avoids CORS issues that block some providers from being called directly from a browser tab, giving one consistent integration path for every provider instead of special-casing each.
- **Canvas engine**: Build on the **tldraw SDK** rather than from scratch. It ships an "Agent" starter kit designed specifically for LLMs reading/writing canvas elements programmatically, supports fully custom shapes (doc cards, tables, image blocks, diagram nodes), and is already production-proven for AI-canvas products — building a comparable canvas engine from scratch would cost months for no clear advantage over what already exists.
  - ✅ **RESOLVED (Aug 2026) — neither tldraw nor Excalidraw. Building on [React Flow](https://github.com/xyflow/xyflow) (`@xyflow/react`), MIT.** Verified against tldraw's own license page: the hobby license is non-commercial, discretionary, and watermarked, and states that *"you and your downstream users will require their own trial, commercial, or hobby license in order to use the SDK in production."* Open-sourcing does not launder that — every researcher cloning the repo would need their own key, which kills the no-friction goal. There is no free unwatermarked path (commercial ≈ $6k/yr). Excalidraw is cleanly MIT but has **no custom React node types** — only a fixed element set plus a `customData` field — so doc cards, editable tables and diagram nodes would have to be hand-positioned DOM overlays. React Flow gives what this project actually needs: every node is a plain React component (1:1 with the block taxonomy), and its state *is* `{nodes, edges}` JSON, which doubles as the file format and the agent's structured view. Freehand ink is not in React Flow's scope and will be an SVG overlay using `perfect-freehand` (MIT). MIT's only obligation is a LICENSE file line — no watermark, no UI credit, no downstream licensing.
  - *Original concern, retained for context:* tldraw is **not** MIT-licensed for production use as of SDK 4.0. Free use is dev-only; production deployment requires a trial, a discretionary "hobby" license (free, but needs approval and keeps a "made with tldraw" watermark), or a commercial license (~$6,000/year). Per tldraw's own license terms, including it in an open-source project doesn't waive this — downstream users who self-host/run the app would each need their own license too. This directly conflicts with the "free, MIT/Apache, no friction for other researchers" goal in Section A. **Alternative:** Excalidraw is confirmed MIT-licensed, open source, and self-hostable (the most popular open-source infinite canvas), though it lacks tldraw's purpose-built AI-agent starter kit — would need more custom work to get equivalent LLM-read/write-to-canvas plumbing. **Decision still open — needs a call between tldraw (better AI tooling out of the box, licensing friction) vs. Excalidraw (clean license, more custom build work) vs. a hobby license from tldraw (free but watermarked/discretionary).**

### C. Canvas & Workspace Model
- **Workspaces**: Multiple independent saved workspaces, each with its own fully independent infinite canvas (a "Redis" project, a "Kubernetes" project, etc., each its own file). Creating a new workspace starts a clean, empty canvas.
- **Within a canvas**: Fully infinite/freeform — not gridded. Users can optionally draw a boundary/frame around a cluster of blocks to categorize a group of related notes, but nothing is forced into structure.
- **Frame creation by the assistant**: The assistant *can* create organizing frames (e.g. grouping findings into "Architecture," "Performance," "Alternatives"), but:
  - On a sparse/empty canvas, it can do this freely.
  - On a canvas with existing user work, it must **explicitly ask permission** before creating a new frame — never silently reorganizes an in-progress board.
- **Workspace browser**: Flat list of saved workspaces (sorted by last-opened), with optional user-defined tags for filtering — no nested folders.
- **Search**: **Global search** across all workspaces and their stored transcripts (not scoped to just the currently open one) — cheap to implement since everything is stored as local structured text/JSON, and genuinely useful once a user has many saved projects.
- **Undo**: AI-made edits (placing a block, generating a diagram) and the user's own manual edits share **one unified undo stack** — Ctrl+Z undoes whichever happened most recently, regardless of who did it. Simplest mental model, and native to tldraw.

### D. Voice Assistant
- **Trigger model**: Always-listening **wake word**, plus a manual toggle to fully turn the assistant on/off (hard off = mic fully inactive, not just idling).
- **Idle behavior**: After a configurable idle period (user-adjustable in settings), the assistant auto-sleeps into low-power wake-word-only mode; saying the wake word instantly reactivates full listening.
- **Listening indicator**: A persistent, always-visible animated indicator (circle / moving wave-blob, Siri/ChatGPT-voice-style) so it's never ambiguous whether the mic is live — non-negotiable given it's an always-listening feature.
- **Voice tech architecture**: **Decoupled pipeline** (separate Speech-to-Text → your chosen reasoning LLM → Text-to-Speech) rather than an all-in-one speech-to-speech API. This is the one architectural choice most directly driven by the product's core feature: model selection. An all-in-one speech-to-speech model (e.g. OpenAI Realtime) would lock the *reasoning* to whichever model powers that voice API — the pipeline keeps voice and "brain" fully independent and swappable, at the cost of somewhat higher latency (~700-800ms vs ~300-500ms).
- **Clarification questions from the assistant**: Non-interrupting. If the assistant is unsure about something on the canvas, it waits until the user finishes speaking/the current turn ends, then asks — or drops a **temporary** "?" marker on the relevant block for the user to address whenever (marker isn't permanent; it clears once addressed).
- **Conversation storage**: Text transcripts only (no raw audio), stored in the same directory as the workspace's canvas data — keeps a project fully self-contained and portable as a folder.

### E. Agent / Reasoning Model
- **Model selection**: User-selectable — the app should support multiple providers (Anthropic, OpenAI, Google, etc.), each activated once the user supplies their own API key for it. No AI functionality is bundled or paid for by the app itself.
- **Graceful degradation**: With zero API keys configured, canvas drawing/notes/tables work fully standalone offline. Voice assistant, web search, paper-fetching, and image generation each activate independently once their respective key is present.

### F. Canvas Interaction & Autonomy
- **Writing to canvas**: Command-only — the assistant writes to the board when explicitly told to, not autonomously.
- **Placement**: The assistant proposes where to place new content rather than deciding silently:
  - On a mostly-empty canvas, it can drop content on the boundary/edge for the user to position themselves.
  - It can ask the user to point to a spot, or it can highlight/color a block and draw a connecting arrow to the related topic it thinks it belongs near — giving the user a fast way to confirm or redirect the link.
- **Canvas perception**: Both, used contextually:
  - **Structured data model** (element positions, text content, linked document contents) as the default — precise, cheap, and lets the assistant reason exactly about what's on the board and how things relate.
  - **Vision (rendered image)** as a fallback specifically for interpreting hand-drawn sketches, freeform arrows, or anything that isn't a native structured shape.
  - If the assistant is unclear about a piece of text, a diagram, or *why* two things are connected, it asks the user directly (via the non-interrupting clarification flow in section D) rather than guessing.

### G. Research & Document Handling
- **Uploads**: Users bring their own documents (PDF, DOCX, Markdown at launch).
- **Document viewer**: Any uploaded document (PDF, DOCX, or Markdown alike) opens in a scrollable, highlightable reading dialogue directly in-app — same treatment across all three formats. Saved/scraped web pages are deferred (needs proper HTML sanitization/rendering — more work, less immediate value than the user's own uploaded papers).
- **Excerpting to canvas**: From within that reading dialogue, the user can select a sentence/paragraph and tell the assistant to lay it out on the canvas as a block.
- **Citation/provenance**: Excerpted blocks are **plain, disconnected text** on the canvas (no live backlink to the source document/page) — the user already knows where it came from from the act of pulling it out themselves.
- **Context strategy**: Full document text fed directly into context for now (no embedding/RAG index) — appropriate for the realistic size of a single research project's document set. Revisit with a proper retrieval index only if/when a workspace's document volume actually strains context limits.
- **Research sources**: Combination of general web search, **arXiv API**, **Semantic Scholar API**, **OpenAlex** (broad, free, 250M+ works), and **PubMed** — the user can also direct the assistant to fetch from a specific named source ("get this from arXiv"). Google Scholar is explicitly **not** scraped (no official API; scraping violates its Terms of Service and would be a liability risk for an open-source tool). Anything Scholar-only that a user needs, they upload as a document themselves.

### H. Diagrams, Tables & Image Generation
- **Diagrams/workflows**: Both freeform hand-drawn (the true "corkboard and red string" feel, for personal annotation/connections) **and** structured node-and-edge diagram shapes that the assistant can generate and edit precisely on command (e.g. an architecture diagram) — freeform strokes aren't reliable for an AI to manipulate programmatically, structured shapes are.
- **Tables**: Simple structured grid blocks — editable/sortable text cells, optional basic cell coloring for at-a-glance comparison (e.g. Redis vs. Memcached). Not a spreadsheet (no formulas/computed columns) — that's a different tool's job.
- **Image generation**: Provider-agnostic — user picks their preferred image-gen provider (OpenAI, Gemini, or others) in settings, same BYOK model as the reasoning LLM.

### I. Data, Storage & Privacy
- **Storage location**: Local disk, via the browser's File System Access API (v1) or native filesystem access (v2 desktop app).
- **What's stored per workspace**: Canvas data, uploaded/fetched documents, and voice-conversation transcripts — all together in one self-contained project folder.
- **What's *not* stored**: Raw audio recordings (transcripts only), and no data of any kind leaves the user's machine except direct calls to the AI providers *they* configured, using *their* keys.

---

## Explicitly Deferred (Not v1, But Noted for Later)

- **Real-time multiplayer collaboration** — flagged as a possible future feature aimed at industry/org users, not built for the personal/open-source v1. tldraw's `sync` package would be the natural path if revisited.
- **Native desktop app (Electron/Tauri)** — planned fast-follow once the web MVP's core loop is proven, for true background wake-word listening and non-Chromium file access.
- **Saved/scraped web pages in the document viewer** — deferred pending proper HTML sanitization/rendering.
- **Spreadsheet-style tables** (formulas, computed columns).
- **Live citation backlinks** from canvas excerpts to their source document/page — currently plain disconnected text blocks; could be added later without breaking anything.
- **Google Scholar access** — intentionally out of scope (no legitimate API); users route around this via manual upload.
- **Retrieval/embedding (RAG) indexing** of documents — only if a workspace's document volume ever actually requires it.

---

## Competitive Landscape (checked Aug 2026)

No existing product matches this combination exactly — closest overlaps found:

- **Curiso.ai** — infinite canvas + BYOK across multiple providers (OpenAI, Anthropic, Google) + local inference support + a node system linking notes/research/chats for shared context + RAG over added documents/websites. Closest overall match to the canvas + BYOK + research-context idea, but interaction is chat-based, not voice.
- **Kosmik** — infinite canvas with a browser and PDF reader built into the canvas itself, strong for collecting references/web content visually; a reviewer noted the canvas doesn't reason about what's collected — good at the "gather documents" half, weak on the "AI assistant" half.
- **Storyflow** — positioned specifically as the tool where an AI reads the full research board and reasons across all sources at once — closer to the "assistant understands the whole canvas" requirement, still chat/text-based.
- **Heptabase** — strong visual research canvas (markdown cards, backlinks, cards reusable across boards), no AI-voice layer.
- **Google Stitch** — added an infinite canvas with voice interaction (March 2026), but it's a UI/design tool, not a research tool.

**The gap this project fills**: a voice-first assistant (not just chat) that can be talked to irregularly rather than in constant back-and-forth, combined with agentic canvas writes, paper-fetching, image generation, and a fully local/BYOK/open-source posture — that specific combination doesn't appear to exist yet as one shipped product.

---

## Key Technical Notes / Risks Surfaced During Planning

- The File System Access API for local storage is **Chromium-only** at launch (Chrome/Edge/Brave) — Firefox/Safari users won't get persistent local folder access until/unless the desktop wrapper ships.
- True OS-level background wake-word listening isn't possible from a browser tab — v1's wake word only listens while the app window is open and focused.
- A small **local relay proxy**, bundled with the app and running only on the user's own machine, is needed from day one to avoid CORS issues when calling AI providers directly from the browser — not a hosted backend, purely a local traffic-relay process.
- Decoupled voice pipeline (STT → LLM → TTS) trades ~200-400ms of extra latency for full reasoning-model independence — the right tradeoff given model selection is a core feature, not a nice-to-have.

---

## Verified Findings (measured, not assumed — Aug 2026)

Run against Tauri v2 / WebView2 `Edg/151` on Windows 11. Every item below was tested in the actual runtime rather than reasoned about.

| Capability | Result | Consequence |
| --- | --- | --- |
| Rust workspace file I/O (create, board write, transcript append, list) | ✅ works | Workspace folder model is sound |
| OS keychain round-trip (`keyring` crate) | ✅ works | BYOK keys never touch `settings.json` |
| `getUserMedia` + `MediaRecorder` in WebView2 | ✅ works **only with a browser arg** | See below — no Rust `cpal` needed for v1 |
| `speechSynthesis` in WebView2 | ❌ **zero voices exposed** | Browser TTS is not viable; use the Rust `tts` crate |
| OS speech synthesis via Rust `tts` crate | ✅ engine initialises and accepts utterances | This is the zero-key TTS path |

**The microphone finding is the important one.** By default `getUserMedia` in WebView2 does not resolve *or* reject — it hangs forever, with no permission dialog shown. The fix is one line in `tauri.conf.json`:

```json
"additionalBrowserArgs": "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --use-fake-ui-for-media-stream"
```

Despite the name, `--use-fake-ui-for-media-stream` fakes only the *permission prompt* (auto-granting it) — not the device. Confirmed by capturing 18–19 KB of real Opus audio from a real `Realtek(R) Audio` microphone array. The device-faking flag is the different `--use-fake-device-for-media-stream`. Note this auto-grants media permission app-wide, which is acceptable here because the app is the only thing loaded in the webview and it is the user's own machine — but it should not be carried into any build that loads third-party web content.

**Correction to Section D:** the Web Speech API cannot serve as the zero-key STT under Tauri. `SpeechRecognition` is a Chromium feature backed by Google's cloud service and is absent from WebView2/WKWebView. Speech *synthesis* is a separate API and was tested independently — it is present but exposes no voices, so it is unusable too. The zero-key path is therefore local Whisper (STT, M2) plus the Rust `tts` crate (TTS, working now).

---

## Build Log — Milestone 2 (Aug 2026)

Decisions made while building, recorded because the reasoning is not recoverable
from the diff.

### The agent loop was never real until it was

M1 shipped the loop unexercised. Running it revealed two faults, both from
adapters written against an older model generation: `max_tokens` was 2048 with no
`thinking` config, but on current models thinking is on by default and shares
that budget, so replies truncated; and `stop_reason: "refusal"` arrives as an
HTTP 200 with empty content, which the loop read as a normal end of turn and
reported as silence. Neither would have surfaced from tests.

### Providers are a factory, not a file each

`openai.ts` exports `openAICompatible({url, models})`. OpenAI, Groq, Cerebras and
the user-configured endpoint are all configuration over it. The custom provider
resolves its URL **per request**, so editing it in Settings takes effect on the
next turn without a restart, and it omits the `Authorization` header entirely
when there is no key — some local servers reject an empty bearer.

### Local by default

A fresh install points at `http://127.0.0.1:11434/v1` with a blank model. The
BYOK posture only means something if the app can reason without the user paying
anyone first. Verified against Ollama serving an 8B model, which handled
multi-step tool calling including two calls in one turn.

**The HTTP capability is an allowlist**, and this was nearly a silent failure: the
custom provider was tested through curl and would have been blocked in-app,
because neither loopback nor the user's endpoint was on the list. Any HTTPS host
is now permitted, since the custom endpoint is one the user types and the list
cannot know it in advance. Plain HTTP stays restricted to loopback, so a mistyped
endpoint cannot quietly ship a prompt somewhere unencrypted.

### Layout is derived, never stored

Diagrams take `{nodes, edges}` and compute positions here. That keeps the model's
job to describing structure rather than doing arithmetic about pixels — which
models are bad at, and which would be wrong the moment the card is resized. Depth
assignment is longest-path with a bounded pass count rather than a topological
sort, because hand-drawn research diagrams contain cycles and a topological sort
simply fails on one. Confirmed immediately: asked for a request flow, the model
returned `api -> cache -> api`.

### Tools were validated against the smallest model available

A schema an 8B local model can follow is a schema any model can follow. Both new
block tools were checked that way. Neither handler trusts the result: table rows
are normalised to the column count rather than rejected, and diagram edges
referencing unknown node ids are dropped with a count reported back — a dangling
edge renders as nothing and would otherwise read as a silent failure.

### Partial failure has to be visible

Paper search fans out across four indexes with `allSettled`, not `all`. Semantic
Scholar answered 429 on the first live check, since its unauthenticated pool
rate-limits hard. Which sources failed is reported in the tool result, because a
thin result set that silently omits two indexes reads to a model as "little has
been written on this" rather than "two indexes were unreachable". The same
principle governs document reads: truncation is disclosed in the result so the
assistant reports a partial read rather than summarising a fraction as the whole.

### Two bugs worth remembering

**The tutorial seeded twice.** `StrictMode` double-invokes effects, and the
`localStorage` guard was only written *after* the create round-tripped to disk —
so both calls read "not seeded" eleven milliseconds apart. A flag written after
an await is not a guard. Fixed with a shared in-flight promise.

**Notes could not be deleted.** Delete and Backspace are React Flow's delete
keys, but a note is almost entirely text inputs, so the key landed in a field and
edited text. Cards with less text surface were deletable and notes were not,
which read as notes being undeletable rather than as a focus problem. Every block
now carries an explicit delete control, independent of where focus happens to be.

### Deliberately not done

- **Wake word.** Needs a dedicated engine (Porcupine, or local Whisper running
  continuously). Voice is hold-to-talk until one exists; a half-built
  always-listening feature is worse than none.
- **Local speech-to-text.** The zero-key path is whisper.cpp, which means
  shipping a binary and a model file. Not bundled.
- **Image generation.** Spec H, not started.
- **Google Scholar.** No official API; scraping violates its terms. Users import
  Scholar-only material as a document instead.

---

## Build Log — Milestone 3 (Aug 2026)

### A file the user is invited to edit is a file that arrives malformed

`board.json` is described to users as a plain file they own and may open in a text
editor, and loading it did `load({...emptyBoard(), ...board})`. A spread does not
validate: `"nodes": null` replaced the empty array with null, React Flow called
`.map()` on it, and the app went white with no route back to the workspace list.
The path in was a file the README encourages people to open.

The rule chosen is salvage, not reject. `coerce.ts` keeps every block that can be
rendered and drops only what cannot, then reports the count. Rejecting the file
outright would be correct and useless — the user would be told their board is
invalid and given nothing. What gets dropped: an unknown block kind, a missing or
non-string id, a duplicate id (React Flow renders one and silently loses the
other, and every command targeting that id hits whichever came first), an edge
pointing at a block that is not there, a one-point ink stroke (draws nothing, and
the eraser can never find it), and a zoom of zero, which collapses the canvas to
nothing visible and is indistinguishable from having lost the board.

This does not only matter for hand editing. A board written by a newer version, a
file restored from a partial sync, or a disk that filled mid-write all arrive the
same way.

### Web search is BYOK because the alternative was already refused

Paper search is free and keyless because four public academic indexes exist.
General web search has no equivalent: every usable API is paid, and the only
keyless route is scraping a search engine's results page. This project already
declined to scrape Google Scholar on exactly those grounds, and doing it here
would have made that position decorative. So web search is Brave or Tavily, BYOK,
and stays dark until a key exists — the same way every other optional capability
behaves.

### Generated images are files, not data URLs

An image provider will happily return a hosted URL, and every one of them expires.
A workspace folder has to still open a year from now with no network, so providers
are required to return base64 and a gateway that ignores `response_format` is
reported as returning a link rather than as returning nothing.

The bytes go to `<workspace>/images/` through a new Rust `write_image`, never
inline into the board. A `board.json` carrying megabytes of base64 stops being
something anyone can open in a text editor, and it is also what the assistant
reads on every single turn — the image would burn context forever for no benefit.

The filename comes from the model, so it is reduced to safe characters rather than
validated and rejected. Rejecting means the tool fails on a name the model had no
way to know was wrong; reducing means it works and the file lands where it should.

### A tool the user cannot use should not be offered

Tools are filtered by capability before the spec is sent. An unconfigured tool
cannot succeed, and leaving it in the list costs a whole step: the model calls it,
gets an explanation back, and has to pick something else. The largest models
absorb that. The smallest local ones — the ones this project explicitly supports —
often do not, and spend the turn stuck. The dispatch cases still check, because
settings can change mid-conversation, and the filter is recomputed per step so a
key added while talking becomes usable without restarting.

### The blocks looked like objects and behaved like forms

Every block rendered its live inputs straight onto the canvas. An input swallows
the pointer, so three separate complaints turned out to be one cause: a click
landed inside a text field instead of selecting the card, the field's `nodrag`
meant most of a card could not be dragged at all, and its `nowheel` meant the
wheel scrolled the field instead of zooming the board.

Editing is now a mode entered deliberately: one click selects the block, a double
click drills into its contents, Escape steps back out, and deselecting leaves.
Until then the contents carry `pointerEvents: none`, which is what does the actual
work — the press is delivered to React Flow's node wrapper underneath, so the drag
starts, and the wheel event reaches the pane, so the board zooms. It also makes
every `nodrag` and `nowheel` inside harmless while inactive, because neither
element is ever the event target.

`zoomOnDoubleClick` had to go off with it. Double click is now how you edit, and
it cannot also be how the board zooms, or every attempt to type jumps the
viewport.

### Verified

Tool discrimination was checked against a real tool-calling model rather than
assumed, the same standard milestone 2 set: nemotron-3.5 32B over Ollama picked
`search_papers`, `search_web`, `generate_image` and `add_note` correctly on four
prompts written to be confusable. 82 frontend tests, 11 Rust tests, type-check
clean.

### Still deliberately not done

- **Wake word** and **local speech-to-text** are unchanged from milestone 2. Both
  need a shipped binary and model file; neither is a code problem.
- **Vision fallback for ink.** Still reserved in `serialize.ts`, still not worth
  building until someone hits the limits of the structured view.
