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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_makes_safe_ids() {
        assert_eq!(slugify("Redis Deep Dive"), "redis-deep-dive");
        assert_eq!(slugify("  C++  //  Notes "), "c-notes");
        assert_eq!(slugify("!!!"), "workspace");
    }
}
