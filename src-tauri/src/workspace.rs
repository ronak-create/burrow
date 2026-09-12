//! Workspace storage. A workspace is a self-contained folder on the user's disk:
//!
//!   <root>/<id>/
//!     workspace.json    metadata
//!     board.json        { nodes, edges, ink, viewport }
//!     transcript.jsonl  append-only, text only, never audio
//!     documents/        user uploads + fetched papers
//!     images/           generated images
//!
//! Everything is plain JSON the user owns. Nothing here talks to a network.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMeta {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub created_at: String,
    pub last_opened_at: String,
    /// Pinned workspaces sort above everything else in the browser.
    #[serde(default)]
    pub pinned: bool,
    /// Derived at list time from board.json, not persisted in workspace.json.
    #[serde(default)]
    pub block_count: usize,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Turn a display name into a filesystem-safe folder id.
fn slugify(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut prev_dash = false;
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "workspace".to_string()
    } else {
        trimmed
    }
}

fn ws_dir(root: &str, id: &str) -> PathBuf {
    Path::new(root).join(id)
}

fn empty_board() -> serde_json::Value {
    serde_json::json!({
        "nodes": [],
        "edges": [],
        "ink": [],
        "viewport": { "x": 0, "y": 0, "zoom": 1 }
    })
}

fn read_json(path: &Path) -> Result<serde_json::Value, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("parse {}: {e}", path.display()))
}

/// Write via a temp file + rename so a crash mid-write can never truncate a board.
fn write_json_atomic(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, path).map_err(|e| format!("rename into {}: {e}", path.display()))?;
    Ok(())
}

#[tauri::command]
pub fn default_workspaces_root(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .document_dir()
        .map_err(|e| e.to_string())?
        .join("Burrow");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_workspaces(root: String) -> Result<Vec<WorkspaceMeta>, String> {
    let root_path = Path::new(&root);
    if !root_path.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(root_path).map_err(|e| e.to_string())? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let meta_path = entry.path().join("workspace.json");
        if !meta_path.is_file() {
            continue;
        }
        // Skip unreadable folders rather than failing the whole listing.
        let value = match read_json(&meta_path) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let mut meta: WorkspaceMeta = match serde_json::from_value(value) {
            Ok(m) => m,
            Err(_) => continue,
        };
        meta.block_count = read_json(&entry.path().join("board.json"))
            .ok()
            .and_then(|b| b.get("nodes").and_then(|n| n.as_array()).map(|a| a.len()))
            .unwrap_or(0);
        out.push(meta);
    }
    // Most recently opened first (spec C).
    out.sort_by(|a, b| b.last_opened_at.cmp(&a.last_opened_at));
    Ok(out)
}

#[tauri::command]
pub fn create_workspace(
    root: String,
    name: String,
    tags: Vec<String>,
    pinned: bool,
) -> Result<WorkspaceMeta, String> {
    let base = slugify(&name);
    // Never clobber an existing workspace: suffix until the folder name is free.
    let mut id = base.clone();
    let mut n = 2;
    while ws_dir(&root, &id).exists() {
        id = format!("{base}-{n}");
        n += 1;
    }

    let dir = ws_dir(&root, &id);
    fs::create_dir_all(dir.join("documents")).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("images")).map_err(|e| e.to_string())?;

    let ts = now();
    let meta = WorkspaceMeta {
        id: id.clone(),
        name,
        tags,
        created_at: ts.clone(),
        last_opened_at: ts,
        pinned,
        block_count: 0,
    };

    write_json_atomic(
        &dir.join("workspace.json"),
        &serde_json::to_value(&meta).map_err(|e| e.to_string())?,
    )?;
    write_json_atomic(&dir.join("board.json"), &empty_board())?;
    fs::write(dir.join("transcript.jsonl"), "").map_err(|e| e.to_string())?;

    Ok(meta)
}

#[tauri::command]
pub fn read_workspace(root: String, id: String) -> Result<WorkspaceMeta, String> {
    let value = read_json(&ws_dir(&root, &id).join("workspace.json"))?;
    serde_json::from_value(value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_workspace_meta(
    root: String,
    id: String,
    name: Option<String>,
    tags: Option<Vec<String>>,
    pinned: Option<bool>,
    touch: bool,
) -> Result<WorkspaceMeta, String> {
    let path = ws_dir(&root, &id).join("workspace.json");
    let mut meta: WorkspaceMeta =
        serde_json::from_value(read_json(&path)?).map_err(|e| e.to_string())?;
    if let Some(n) = name {
        meta.name = n;
    }
    if let Some(t) = tags {
        meta.tags = t;
    }
    if let Some(p) = pinned {
        meta.pinned = p;
    }
    if touch {
        meta.last_opened_at = now();
    }
    write_json_atomic(&path, &serde_json::to_value(&meta).map_err(|e| e.to_string())?)?;
    Ok(meta)
}

#[tauri::command]
pub fn read_board(root: String, id: String) -> Result<serde_json::Value, String> {
    let path = ws_dir(&root, &id).join("board.json");
    if !path.exists() {
        return Ok(empty_board());
    }
    read_json(&path)
}

#[tauri::command]
pub fn write_board(root: String, id: String, board: serde_json::Value) -> Result<(), String> {
    write_json_atomic(&ws_dir(&root, &id).join("board.json"), &board)
}

#[tauri::command]
pub fn append_transcript(root: String, id: String, entry: serde_json::Value) -> Result<(), String> {
    let path = ws_dir(&root, &id).join("transcript.jsonl");
    let line = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("open {}: {e}", path.display()))?;
    writeln!(f, "{line}").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_transcript(root: String, id: String) -> Result<Vec<serde_json::Value>, String> {
    let path = ws_dir(&root, &id).join("transcript.jsonl");
    if !path.exists() {
        return Ok(vec![]);
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect())
}

#[tauri::command]
pub fn delete_workspace(root: String, id: String) -> Result<(), String> {
    let dir = ws_dir(&root, &id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Recursive copy, used by both halves of project export/import. std only — a
/// workspace is a shallow folder of JSON and the user's own files, not a tree
/// worth taking a dependency for.
fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|e| format!("create {}: {e}", to.display()))?;
    for entry in fs::read_dir(from).map_err(|e| format!("read {}: {e}", from.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src = entry.path();
        let dst = to.join(entry.file_name());
        if src.is_dir() {
            copy_dir(&src, &dst)?;
        } else {
            fs::copy(&src, &dst).map_err(|e| format!("copy {}: {e}", src.display()))?;
        }
    }
    Ok(())
}

/// Copy a workspace out to a folder the user picked.
///
/// What lands there is the same directory Burrow already keeps on disk, so an
/// export is something you can open, read and back up with ordinary tools —
/// board, documents, images and transcript — rather than an archive format only
/// this app understands. That is also why there is no bundling step: the folder
/// *is* the format.
#[tauri::command]
pub fn export_workspace(root: String, id: String, dest_dir: String) -> Result<String, String> {
    let src = ws_dir(&root, &id);
    if !src.join("workspace.json").exists() {
        return Err(format!("{} is not a workspace", src.display()));
    }
    let meta: WorkspaceMeta = serde_json::from_value(read_json(&src.join("workspace.json"))?)
        .map_err(|e| e.to_string())?;

    // Never write over whatever is already sitting in the chosen folder.
    let base = slugify(&meta.name);
    let mut out = Path::new(&dest_dir).join(&base);
    let mut n = 2;
    while out.exists() {
        out = Path::new(&dest_dir).join(format!("{base}-{n}"));
        n += 1;
    }
    copy_dir(&src, &out)?;
    Ok(out.display().to_string())
}

/// Adopt an exported folder as a new workspace.
///
/// It gets a fresh id and a fresh last-opened time, so importing the same
/// project twice gives two independent copies instead of one silently
/// overwriting the other. The name inside `workspace.json` is kept, because that
/// is what the person who exported it called the thing.
#[tauri::command]
pub fn import_workspace(root: String, source_dir: String) -> Result<WorkspaceMeta, String> {
    let src = Path::new(&source_dir);
    let meta_path = src.join("workspace.json");
    if !meta_path.exists() {
        return Err(format!(
            "{} does not look like a Burrow project - there is no workspace.json inside it",
            src.display()
        ));
    }
    let mut meta: WorkspaceMeta =
        serde_json::from_value(read_json(&meta_path)?).map_err(|e| e.to_string())?;

    let base = slugify(&meta.name);
    let mut id = base.clone();
    let mut n = 2;
    while ws_dir(&root, &id).exists() {
        id = format!("{base}-{n}");
        n += 1;
    }
    let dir = ws_dir(&root, &id);
    copy_dir(src, &dir)?;

    // Keep the exporter's name when it is free, but follow the folder when it is
    // not. Importing a project you already have is the normal case — a restore,
    // a copy from another machine — and leaving both called the same thing puts
    // two identical cards in the list with no way to tell which is which. The
    // suffix matches the one the folder just took, so "Getting Started (2)" is
    // always getting-started-2 on disk.
    if n > 2 {
        meta.name = format!("{} ({})", meta.name, n - 1);
    }
    meta.id = id;
    meta.last_opened_at = now();
    // Pinning says where something sits in *your* list, not what the project is,
    // so it does not travel with the folder. An import arriving pre-pinned to the
    // top of someone else's list is the exporter making a decision that was never
    // theirs to make.
    meta.pinned = false;
    // A folder hand-copied from an older install may be missing either of these,
    // and the rest of the app assumes both exist.
    fs::create_dir_all(dir.join("documents")).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("images")).map_err(|e| e.to_string())?;
    write_json_atomic(
        &dir.join("workspace.json"),
        &serde_json::to_value(&meta).map_err(|e| e.to_string())?,
    )?;
    Ok(meta)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_makes_safe_ids() {
        assert_eq!(slugify("Redis Deep Dive"), "redis-deep-dive");
        assert_eq!(slugify("  C++  //  Notes "), "c-notes");
        assert_eq!(slugify("!!!"), "workspace");
    }

    /// A throwaway directory. Nanoseconds rather than a counter because tests
    /// run in parallel threads and two of these can be created in the same
    /// millisecond.
    fn temp_dir(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "burrow-test-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn export_then_import_round_trips_the_whole_folder() {
        let root = temp_dir("root");
        let out = temp_dir("out");
        let r = root.display().to_string();

        // Pinned on purpose: it must not survive the trip.
        let ws = create_workspace(r.clone(), "Redis Deep Dive".into(), vec![], true).unwrap();
        write_board(
            r.clone(),
            ws.id.clone(),
            serde_json::json!({ "nodes": [{ "id": "n1" }] }),
        )
        .unwrap();
        fs::write(ws_dir(&r, &ws.id).join("documents").join("paper.txt"), "hello").unwrap();

        let dest = export_workspace(r.clone(), ws.id.clone(), out.display().to_string()).unwrap();

        // The export has to stand on its own, uploads included — a copy that
        // quietly left the documents behind would look identical in the list.
        assert!(Path::new(&dest).join("workspace.json").exists());
        assert_eq!(
            fs::read_to_string(Path::new(&dest).join("documents").join("paper.txt")).unwrap(),
            "hello"
        );

        let imported = import_workspace(r.clone(), dest).unwrap();
        assert_ne!(imported.id, ws.id, "an import must never land on the original");
        assert!(
            !imported.pinned,
            "pinning belongs to the list you import into, not to the folder"
        );
        let board = read_board(r.clone(), imported.id).unwrap();
        assert_eq!(board["nodes"][0]["id"], "n1");

        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&out).ok();
    }

    #[test]
    fn importing_a_name_already_taken_disambiguates_id_and_name_together() {
        let root = temp_dir("dup");
        let out = temp_dir("dupout");
        let r = root.display().to_string();

        let ws = create_workspace(r.clone(), "Getting Started".into(), vec![], false).unwrap();
        let dest = export_workspace(r.clone(), ws.id.clone(), out.display().to_string()).unwrap();

        // Two cards reading "Getting Started, 13 blocks" with nothing to tell
        // them apart is the bug this guards against.
        let first = import_workspace(r.clone(), dest.clone()).unwrap();
        assert_eq!(first.id, "getting-started-2");
        assert_eq!(first.name, "Getting Started (2)");

        let second = import_workspace(r.clone(), dest).unwrap();
        assert_eq!(second.id, "getting-started-3");
        assert_eq!(second.name, "Getting Started (3)");

        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&out).ok();
    }

    #[test]
    fn importing_something_that_is_not_a_project_says_so() {
        let root = temp_dir("bad");
        let src = temp_dir("notaproject");
        let err =
            import_workspace(root.display().to_string(), src.display().to_string()).unwrap_err();
        assert!(err.contains("workspace.json"), "unhelpful error: {err}");

        fs::remove_dir_all(&root).ok();
        fs::remove_dir_all(&src).ok();
    }
}

/// A match from global search.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub workspace_id: String,
    pub workspace_name: String,
    /// "block" or "transcript" — what the text was found in.
    pub kind: String,
    /// Enough surrounding text to recognise the match.
    pub snippet: String,
}

/// Case-insensitive substring search returning a snippet around the first match.
fn snippet_around(haystack: &str, needle_lower: &str, width: usize) -> Option<String> {
    let lower = haystack.to_lowercase();
    let at = lower.find(needle_lower)?;

    // Windows are computed on char boundaries, not byte offsets — slicing a UTF-8
    // string mid-character panics, and research text is full of non-ASCII.
    let chars: Vec<char> = haystack.chars().collect();
    let char_at = haystack[..at].chars().count();
    let start = char_at.saturating_sub(width);
    let end = (char_at + needle_lower.chars().count() + width).min(chars.len());

    let mut out = String::new();
    if start > 0 {
        out.push('…');
    }
    out.extend(&chars[start..end]);
    if end < chars.len() {
        out.push('…');
    }
    Some(out.split_whitespace().collect::<Vec<_>>().join(" "))
}

/// Pull the human-readable strings out of one board node's `data`.
fn node_text(node: &serde_json::Value) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(data) = node.get("data").and_then(|d| d.as_object()) {
        for (key, value) in data {
            // Skip bookkeeping fields; only text a person wrote or read matters.
            if matches!(key.as_str(), "marker" | "color" | "variant" | "contains" | "filled") {
                continue;
            }
            match value {
                serde_json::Value::String(s) => parts.push(s.clone()),
                serde_json::Value::Array(items) => {
                    // Table rows and columns, diagram nodes and edges.
                    for item in items {
                        match item {
                            serde_json::Value::String(s) => parts.push(s.clone()),
                            serde_json::Value::Array(inner) => parts.extend(
                                inner.iter().filter_map(|v| v.as_str().map(str::to_string)),
                            ),
                            serde_json::Value::Object(o) => parts.extend(
                                o.values().filter_map(|v| v.as_str().map(str::to_string)),
                            ),
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }
    }
    parts.join(" ")
}

/// Search every workspace's board and transcript (spec C).
///
/// Global rather than scoped to the open workspace, because the thing a
/// researcher actually wants is "where did I see that before" across projects,
/// and everything is local structured text so there is nothing to index.
///
/// Results are capped: this reads every board and transcript on disk, and a query
/// like "a" would otherwise return the entire corpus to the UI.
#[tauri::command]
pub fn search_workspaces(root: String, query: String) -> Result<Vec<SearchHit>, String> {
    const MAX_HITS: usize = 60;
    const PER_WORKSPACE: usize = 6;

    let needle = query.trim().to_lowercase();
    if needle.len() < 2 {
        return Ok(vec![]);
    }

    let mut hits = Vec::new();
    for meta in list_workspaces(root.clone())? {
        if hits.len() >= MAX_HITS {
            break;
        }
        let dir = ws_dir(&root, &meta.id);
        let mut local = 0;

        if let Ok(board) = read_json(&dir.join("board.json")) {
            if let Some(nodes) = board.get("nodes").and_then(|n| n.as_array()) {
                for node in nodes {
                    if local >= PER_WORKSPACE {
                        break;
                    }
                    let text = node_text(node);
                    if let Some(snippet) = snippet_around(&text, &needle, 60) {
                        hits.push(SearchHit {
                            workspace_id: meta.id.clone(),
                            workspace_name: meta.name.clone(),
                            kind: "block".to_string(),
                            snippet,
                        });
                        local += 1;
                    }
                }
            }
        }

        // Transcripts are JSONL, so a malformed line skips rather than aborting
        // the whole file — a partial transcript is still worth searching.
        if let Ok(text) = fs::read_to_string(dir.join("transcript.jsonl")) {
            for line in text.lines() {
                if local >= PER_WORKSPACE {
                    break;
                }
                let Ok(entry) = serde_json::from_str::<serde_json::Value>(line) else {
                    continue;
                };
                let said = entry.get("text").and_then(|t| t.as_str()).unwrap_or("");
                if let Some(snippet) = snippet_around(said, &needle, 60) {
                    hits.push(SearchHit {
                        workspace_id: meta.id.clone(),
                        workspace_name: meta.name.clone(),
                        kind: "transcript".to_string(),
                        snippet,
                    });
                    local += 1;
                }
            }
        }
    }
    Ok(hits)
}

#[cfg(test)]
mod search_tests {
    use super::*;

    #[test]
    fn snippet_is_case_insensitive_and_marks_truncation() {
        let text = "The quick brown fox jumps over the lazy dog and keeps running for a while";
        let s = snippet_around(text, "fox", 10).unwrap();
        assert!(s.to_lowercase().contains("fox"));
        assert!(s.starts_with('…'), "expected leading ellipsis, got {s:?}");
    }

    #[test]
    fn snippet_does_not_split_multibyte_characters() {
        // Slicing this by byte offset would panic; by char it must not.
        let text = "protégé café naïve — résumé follows the pattern";
        let s = snippet_around(text, "naïve", 5).unwrap();
        assert!(s.contains("naïve"), "got {s:?}");
    }

    #[test]
    fn misses_return_none() {
        assert!(snippet_around("nothing here", "absent", 10).is_none());
    }

    #[test]
    fn node_text_reaches_into_table_rows() {
        let node = serde_json::json!({
            "data": { "title": "Compare", "columns": ["A", "B"],
                      "rows": [["redis", "memcached"]], "color": "slate" }
        });
        let text = node_text(&node);
        assert!(text.contains("memcached"), "got {text:?}");
        // Bookkeeping fields must not pollute the searchable text.
        assert!(!text.contains("slate"), "got {text:?}");
    }
}
