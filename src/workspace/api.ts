import { invoke } from "@tauri-apps/api/core";
import type { Board } from "../canvas/types";

/**
 * Typed surface over the Rust workspace commands. Every path here stays on the
 * user's disk — nothing in this module touches a network.
 */

export interface WorkspaceMeta {
  id: string;
  name: string;
  tags: string[];
  createdAt: string;
  lastOpenedAt: string;
  /** Pinned workspaces sort above everything else in the browser. */
  pinned: boolean;
  /** Derived from board.json at list time, not stored in workspace.json. */
  blockCount: number;
}

export interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  at: string;
  /** Present when the turn produced board edits, for "what did it do" review. */
  commands?: string[];
}

export const defaultWorkspacesRoot = () => invoke<string>("default_workspaces_root");

export const listWorkspaces = (root: string) =>
  invoke<WorkspaceMeta[]>("list_workspaces", { root });

export const createWorkspace = (
  root: string,
  name: string,
  tags: string[] = [],
  pinned = false,
) => invoke<WorkspaceMeta>("create_workspace", { root, name, tags, pinned });

export const readWorkspace = (root: string, id: string) =>
  invoke<WorkspaceMeta>("read_workspace", { root, id });

export const updateWorkspaceMeta = (
  root: string,
  id: string,
  opts: { name?: string; tags?: string[]; pinned?: boolean; touch?: boolean } = {},
) =>
  invoke<WorkspaceMeta>("update_workspace_meta", {
    root,
    id,
    name: opts.name ?? null,
    tags: opts.tags ?? null,
    pinned: opts.pinned ?? null,
    touch: opts.touch ?? false,
  });

export const readBoard = (root: string, id: string) => invoke<Board>("read_board", { root, id });

export const writeBoard = (root: string, id: string, board: Board) =>
  invoke<void>("write_board", { root, id, board });

export const appendTranscript = (root: string, id: string, entry: TranscriptEntry) =>
  invoke<void>("append_transcript", { root, id, entry });

export const readTranscript = (root: string, id: string) =>
  invoke<TranscriptEntry[]>("read_transcript", { root, id });

export const deleteWorkspace = (root: string, id: string) =>
  invoke<void>("delete_workspace", { root, id });

/* ---------- BYOK keys (OS keychain) ---------- */

export const setApiKey = (provider: string, key: string) =>
  invoke<void>("set_api_key", { provider, key });

/** Only the provider layer should call this. UI asks `hasApiKey` instead. */
export const getApiKey = (provider: string) => invoke<string | null>("get_api_key", { provider });

export const hasApiKey = (provider: string) => invoke<boolean>("has_api_key", { provider });

export const deleteApiKey = (provider: string) => invoke<void>("delete_api_key", { provider });

export const configuredProviders = (providers: string[]) =>
  invoke<string[]>("configured_providers", { providers });

/* ---------- documents and images (spec G) ---------- */

export interface DocumentInfo {
  /** Filename relative to the workspace's documents/ or images/ folder. */
  file: string;
  sizeBytes: number;
  /** Lowercased extension without the dot. Empty when there is none. */
  kind: string;
}

/** Copy a file into <workspace>/documents/. Returns the name it landed under. */
export const importDocument = (root: string, id: string, source: string) =>
  invoke<DocumentInfo>("import_document", { root, id, source });

/** Copy a file into <workspace>/images/. */
export const importImage = (root: string, id: string, source: string) =>
  invoke<DocumentInfo>("import_image", { root, id, source });

/**
 * Write generated image bytes into <workspace>/images/ (spec H).
 *
 * `stem` is a naming hint, not a path — the Rust side reduces it to safe
 * characters and suffixes it if taken. Returns the name it actually landed under.
 */
export const writeImage = (
  root: string,
  id: string,
  stem: string,
  ext: string,
  base64Data: string,
) => invoke<DocumentInfo>("write_image", { root, id, stem, ext, base64Data });

export const listDocuments = (root: string, id: string) =>
  invoke<DocumentInfo[]>("list_documents", { root, id });

/** Extracted plain text — what the reader shows and what the assistant is given. */
export const readDocumentText = (root: string, id: string, file: string) =>
  invoke<string>("read_document_text", { root, id, file });

export const readImageDataUrl = (root: string, id: string, file: string) =>
  invoke<string>("read_image_data_url", { root, id, file });

export const deleteDocument = (root: string, id: string, file: string) =>
  invoke<void>("delete_document", { root, id, file });

/* ---------- global search (spec C) ---------- */

export interface SearchHit {
  workspaceId: string;
  workspaceName: string;
  /** "block" or "transcript" — what the text was found in. */
  kind: "block" | "transcript";
  snippet: string;
}

/** Search every workspace's board and transcript, not just the open one. */
export const searchWorkspaces = (root: string, query: string) =>
  invoke<SearchHit[]>("search_workspaces", { root, query });
