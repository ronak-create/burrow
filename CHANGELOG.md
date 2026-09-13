# Changelog

Notable changes per release. Dates are release dates; both releases so far are
unsigned previews.

## Unreleased

- Installers are built by CI from the tagged commit rather than by hand
  (`.github/workflows/release.yml`), and every push runs type-check, tests and
  `cargo clippy` (`.github/workflows/ci.yml`).
- A real Content Security Policy. All network calls go through the Rust HTTP
  client, so the webview itself no longer needs to reach anything.
- The webview no longer disables SmartScreen.
- Installer metadata is filled in: publisher, copyright, description, license.
  Windows file properties used to read "A Tauri App" by "you".
- macOS and Linux builds, from the same tagged commit as Windows. macOS carries
  the microphone usage description without which the OS denies the mic silently,
  and is ad-hoc signed so arm64 will execute; the `.deb` declares
  `speech-dispatcher` for spoken replies.
- Releases publish SHA-256 checksums. Without a certificate that is the only way
  to tell a real download from a tampered one.
- `SECURITY.md`, and this file.

## v0.2.0 — 12 Sep 2026

The headline is voice: Burrow can listen without a key and without bundling
anything, and it wakes to its own name.

- **Voice input with no API key.** Point at a Whisper server on your own machine
  — whisper.cpp, Speaches, LocalAI or vLLM. whisper.cpp answers on `/inference`
  rather than the OpenAI audio API; that is handled, and recordings are
  converted to the 16 kHz mono WAV it requires.
- **Always-on listening with a wake word**, off by default, with idle sleep back
  to wake-word-only and an indicator that moves with your voice. Matching is
  phonetic, because Whisper produced five spellings of "Burrow" in testing.
- **Whisper's silence hallucinations are filtered** before the session sees
  them, so an invented "Thank you." cannot answer itself or reset the idle clock.
- **`read_sketch`** — the assistant can be asked about your handwriting.
- **The assistant knows what you are looking at**: selection and the visible
  rect are reported, so "this one" resolves.
- **A window that carries its own menus**, a banner, and a document reader that
  opens on double-click.
- The release build no longer grants itself the microphone; WebView2's own
  permission prompt is used.
- Fixes: a flagged block hid its flag when selected; alt-tabbing with Space held
  left the canvas stuck in pan mode; the assistant could answer itself.

## v0.1.0-preview.1 — 28 Aug 2026

First build anyone else could run. Workspaces as folders, the infinite canvas
and every block type, the unified command layer and undo stack, the assistant
loop with its tools, document import, paper search across four open indexes, and
BYOK keys in the OS keychain.
