# Security

## Reporting a vulnerability

Open a [private security advisory](https://github.com/ronak-create/burrow/security/advisories/new),
or email ronakparmar2428@gmail.com. Please don't open a public issue for anything
that could be exploited. Expect a first reply within a week; this is a one-person
project, not a company with a rota.

## What Burrow does with your data

- **API keys** live in the OS keychain (Windows Credential Manager, macOS
  Keychain, Secret Service on Linux) under the service name `burrow`. They are
  never written to `settings.json`, never logged, and the frontend asks
  `has_api_key` rather than reading key material unless it is about to make a
  request with it.
- **Workspaces** are plain folders under `<Documents>/Burrow/`. Boards,
  documents, images and transcripts are files you own and can delete.
- **Transcripts are text only.** Audio is never written to disk and never
  retained after a recording is transcribed.
- **Network calls are the ones you configure.** There is no telemetry, no
  analytics, no crash reporting and no update ping. If every provider is pointed
  at localhost, the app makes no outbound connection at all.

## Known posture, stated plainly

- **Nothing is signed with a real certificate.** Windows SmartScreen warns;
  macOS Gatekeeper warns and needs `xattr -cr` to clear the download quarantine.
  The macOS build carries an ad-hoc signature, which lets an arm64 binary execute
  at all but establishes no identity and should not be read as one. Every release
  publishes SHA-256 checksums — verify against those before clicking through any
  of those warnings, because that check is what the certificate would otherwise
  be doing.
- **The HTTP capability allows any HTTPS host.** `src-tauri/capabilities/default.json`
  ends in `https://*/*` because the whole point of BYOK is that you can point
  Burrow at a gateway nobody anticipated. The named hosts above it document
  intent; they do not constrain it. The constraint that does hold is that only
  the Rust HTTP client can make these calls, with the URL and key coming from
  your own settings.
- **A model can write files inside a workspace.** Image generation and document
  excerpting write into `<workspace>/images/` and `<workspace>/documents/`.
  Names are sanitised (see `write_image` in `src-tauri/src/documents.rs`) and
  writes are confined to the open workspace, but a model you have pointed at can
  put content on your disk, by design.
- **Always-on listening is off by default** and holds the microphone open only
  after you turn it on. The energy detector runs locally; nothing is streamed
  anywhere until speech is detected and sent to the transcription endpoint you
  configured — which is `127.0.0.1` unless you change it.

## Supported versions

Preview releases only so far. Fixes land on `main` and in the next tag; there is
no backport branch.
