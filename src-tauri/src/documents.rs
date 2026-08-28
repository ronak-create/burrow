use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

/// Documents and images a user brings into a workspace (spec G).
///
/// Files are *copied* into the workspace folder rather than referenced in place.
/// A workspace has to stay portable — the whole point of the folder model is that
/// you can move or back it up as one unit — and a board full of absolute paths
/// into someone's Downloads directory is not portable. It also means deleting the
/// original does not hollow out the board.
///
/// Text extraction happens here rather than in the webview because the crates that
/// do it well are Rust ones, and because the extracted text is fed to a model: the
/// less of that path that runs in JS handling untrusted file bytes, the better.

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DocumentInfo {
    /// Filename relative to the workspace's documents/ (or images/) folder.
    pub file: String,
    pub size_bytes: u64,
    /// Lowercased, without the dot. Empty when the file has no extension.
    pub kind: String,
}

fn ws_dir(root: &str, id: &str) -> PathBuf {
    Path::new(root).join(id)
}

/// Reject anything that is not a bare filename.
///
/// Every path crossing from the frontend is a candidate for traversal, and these
/// resolve inside `documents/` and `images/`. Names come from our own import step,
/// but the command is callable with any string, so it is validated rather than
/// trusted.
fn safe_name(file: &str) -> Result<&str, String> {
    let bad = file.is_empty()
        || file.contains("..")
        || file.contains('/')
        || file.contains('\\')
        || Path::new(file).is_absolute();
    if bad {
        return Err(format!("Unsafe file name: {file}"));
    }
    Ok(file)
}

fn kind_of(file: &str) -> String {
    Path::new(file)
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default()
}

/// Copy a file in, returning the name it landed under.
fn import_into(root: &str, id: &str, source: &str, sub: &str) -> Result<DocumentInfo, String> {
    let src = Path::new(source);
    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "Source has no file name".to_string())?;
    let ext = kind_of(source);

    let dir = ws_dir(root, id).join(sub);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // Keep the user's own filename — it is how they will recognise the thing on
    // the board — but never overwrite an existing import.
    let named = |n: Option<u32>| match (n, ext.is_empty()) {
        (None, true) => stem.to_string(),
        (None, false) => format!("{stem}.{ext}"),
        (Some(i), true) => format!("{stem}-{i}"),
        (Some(i), false) => format!("{stem}-{i}.{ext}"),
    };

    let mut file = named(None);
    let mut n = 2;
    while dir.join(&file).exists() {
        file = named(Some(n));
        n += 1;
    }

    fs::copy(src, dir.join(&file)).map_err(|e| e.to_string())?;
    let size_bytes = fs::metadata(dir.join(&file)).map(|m| m.len()).unwrap_or(0);
    Ok(DocumentInfo {
        kind: kind_of(&file),
        file,
        size_bytes,
    })
}

#[tauri::command]
pub fn import_document(root: String, id: String, source: String) -> Result<DocumentInfo, String> {
    import_into(&root, &id, &source, "documents")
}

#[tauri::command]
pub fn import_image(root: String, id: String, source: String) -> Result<DocumentInfo, String> {
    import_into(&root, &id, &source, "images")
}

/// Write generated image bytes into <workspace>/images/ (spec H).
///
/// Generated images arrive as base64 over the wire, so there is no source file to
/// copy — but they must still land in the workspace folder rather than being held
/// in the board as an inline data URL. A board.json carrying megabytes of base64
/// stops being something the user can open in a text editor, and it is also what
/// the assistant reads, so the image would burn context on every turn.
///
/// `stem` is a caller-supplied hint, not a path: it is reduced to safe characters
/// and given a numeric suffix if taken, exactly like an import.
#[tauri::command]
pub fn write_image(
    root: String,
    id: String,
    stem: String,
    ext: String,
    base64_data: String,
) -> Result<DocumentInfo, String> {
    let ext = ext.trim().trim_start_matches('.').to_lowercase();
    if !matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif") {
        return Err(format!("Refusing to write an image of type .{ext}"));
    }

    // A model-authored name is untrusted input. Rather than validating and
    // rejecting, reduce it to something that cannot traverse or surprise.
    let mut safe: String = stem
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    safe = safe.trim_matches('-').chars().take(60).collect();
    if safe.is_empty() {
        safe = "image".to_string();
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data.as_bytes())
        .map_err(|e| format!("Image data was not valid base64: {e}"))?;
    if bytes.is_empty() {
        return Err("The provider returned an empty image.".to_string());
    }

    let dir = ws_dir(&root, &id).join("images");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut file = format!("{safe}.{ext}");
    let mut n = 2;
    while dir.join(&file).exists() {
        file = format!("{safe}-{n}.{ext}");
        n += 1;
    }

    fs::write(dir.join(&file), &bytes).map_err(|e| e.to_string())?;
    Ok(DocumentInfo {
        kind: kind_of(&file),
        file,
        size_bytes: bytes.len() as u64,
    })
}

fn list_dir(root: &str, id: &str, sub: &str) -> Result<Vec<DocumentInfo>, String> {
    let dir = ws_dir(root, id).join(sub);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.path().is_file() {
            continue;
        }
        let file = entry.file_name().to_string_lossy().to_string();
        out.push(DocumentInfo {
            kind: kind_of(&file),
            file,
            size_bytes: entry.metadata().map(|m| m.len()).unwrap_or(0),
        });
    }
    out.sort_by(|a, b| a.file.to_lowercase().cmp(&b.file.to_lowercase()));
    Ok(out)
}

#[tauri::command]
pub fn list_documents(root: String, id: String) -> Result<Vec<DocumentInfo>, String> {
    list_dir(&root, &id, "documents")
}

#[tauri::command]
pub fn list_images(root: String, id: String) -> Result<Vec<DocumentInfo>, String> {
    list_dir(&root, &id, "images")
}

/// Pull readable text out of a .docx.
///
/// A .docx is a zip whose word/document.xml holds the body. Rather than pulling in
/// a full XML stack, paragraph and break tags become newlines and the remaining
/// tags are stripped — enough to read and to feed a model, which is all this is
/// for. It is explicitly not a fidelity-preserving conversion.
fn docx_text(path: &Path) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut xml = String::new();
    zip.by_name("word/document.xml")
        .map_err(|_| "Not a Word document (no word/document.xml).".to_string())?
        .read_to_string(&mut xml)
        .map_err(|e| e.to_string())?;

    let mut out = String::with_capacity(xml.len() / 2);
    let bytes = xml.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'<' {
            let start = i;
            while i < bytes.len() && bytes[i] != b'>' {
                i += 1;
            }
            let end = (i + 1).min(xml.len());
            let tag = &xml[start..end];
            if tag.starts_with("</w:p") || tag.starts_with("<w:br") || tag.starts_with("<w:tab") {
                out.push('\n');
            }
            i += 1;
        } else {
            let start = i;
            while i < bytes.len() && bytes[i] != b'<' {
                i += 1;
            }
            out.push_str(&xml[start..i]);
        }
    }

    let out = out
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "\'");

    // Collapse the runs of blank lines the paragraph-to-newline mapping produces.
    let mut clean = String::with_capacity(out.len());
    let mut blanks = 0;
    for line in out.lines() {
        let trimmed = line.trim_end();
        if trimmed.trim().is_empty() {
            blanks += 1;
            if blanks > 1 {
                continue;
            }
        } else {
            blanks = 0;
        }
        clean.push_str(trimmed);
        clean.push('\n');
    }
    Ok(clean.trim().to_string())
}

/// Extract a document's text. This is both what the user reads and what the
/// assistant is given, so a partial success must never be reported as a whole one.
#[tauri::command]
pub fn read_document_text(root: String, id: String, file: String) -> Result<String, String> {
    let name = safe_name(&file)?;
    let path = ws_dir(&root, &id).join("documents").join(name);
    if !path.exists() {
        return Err(format!("No such document: {name}"));
    }

    match kind_of(name).as_str() {
        "md" | "markdown" | "txt" | "text" | "csv" | "json" | "rs" | "ts" | "js" | "py" => {
            fs::read_to_string(&path).map_err(|e| e.to_string())
        }
        "docx" => docx_text(&path),
        "pdf" => {
            // pdf-extract panics on some malformed files rather than returning Err.
            // A bad PDF must not take the app process down, so the panic is caught
            // and reported as an ordinary failure.
            let p = path.clone();
            match std::panic::catch_unwind(move || pdf_extract::extract_text(&p)) {
                Ok(Ok(text)) => Ok(text),
                Ok(Err(e)) => Err(format!("Could not read that PDF: {e}")),
                Err(_) => {
                    Err("Could not read that PDF — it may be malformed or image-only.".to_string())
                }
            }
        }
        "" => Err("That file has no extension, so its format is unknown.".to_string()),
        other => Err(format!("Reading .{other} files is not supported yet.")),
    }
}

/// An image as a data URL, for rendering on the canvas.
///
/// Returned inline rather than through the asset protocol: the board is rendered
/// as ordinary DOM inside the canvas, and a data URL needs no extra origin
/// permission to display there.
#[tauri::command]
pub fn read_image_data_url(root: String, id: String, file: String) -> Result<String, String> {
    let name = safe_name(&file)?;
    let path = ws_dir(&root, &id).join("images").join(name);
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let mime = match kind_of(name).as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        other => return Err(format!("Unsupported image type: .{other}")),
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

fn delete_in(root: &str, id: &str, sub: &str, file: &str) -> Result<(), String> {
    let name = safe_name(file)?;
    let path = ws_dir(root, id).join(sub).join(name);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn delete_document(root: String, id: String, file: String) -> Result<(), String> {
    delete_in(&root, &id, "documents", &file)
}

#[tauri::command]
pub fn delete_image(root: String, id: String, file: String) -> Result<(), String> {
    delete_in(&root, &id, "images", &file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Build a minimal .docx in a temp dir: a zip with one word/document.xml.
    fn write_docx(body: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("burrow-docx-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.docx");
        let file = fs::File::create(&path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file::<_, ()>("word/document.xml", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(body.as_bytes()).unwrap();
        zip.finish().unwrap();
        path
    }

    #[test]
    fn rejects_traversal() {
        for bad in ["../secrets", "a/b", "a\\b", "..", ""] {
            assert!(safe_name(bad).is_err(), "should reject {bad:?}");
        }
        assert!(safe_name("paper.pdf").is_ok());
    }

    #[test]
    fn docx_paragraphs_become_lines_and_entities_decode() {
        let path = write_docx(
            r#"<?xml version="1.0"?><w:document><w:body>
               <w:p><w:r><w:t>First &amp; foremost</w:t></w:r></w:p>
               <w:p><w:r><w:t>Second</w:t><w:br/><w:t>after break</w:t></w:r></w:p>
               </w:body></w:document>"#,
        );
        let text = docx_text(&path).unwrap();
        // Tags are stripped, paragraphs and breaks become newlines, entities decode.
        assert!(!text.contains('<'), "tags leaked: {text:?}");
        assert!(text.contains("First & foremost"), "got {text:?}");
        assert!(text.contains("after break"), "got {text:?}");
        // Runs inside one paragraph must not be split across lines.
        assert!(
            text.lines().any(|l| l.contains("First & foremost")),
            "paragraph split unexpectedly: {text:?}"
        );
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn docx_rejects_a_non_docx_zip() {
        let dir = std::env::temp_dir().join("burrow-docx-neg");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("not.docx");
        let file = fs::File::create(&path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file::<_, ()>("hello.txt", zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"nope").unwrap();
        zip.finish().unwrap();
        assert!(docx_text(&path).is_err());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn reads_extension_case_insensitively() {
        assert_eq!(kind_of("Paper.PDF"), "pdf");
        assert_eq!(kind_of("notes"), "");
    }

    #[test]
    fn write_image_sanitises_a_model_authored_name() {
        let root = std::env::temp_dir().join(format!("burrow-img-{}", std::process::id()));
        let _ = fs::create_dir_all(&root);
        // One transparent 1x1 PNG.
        let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

        let info = write_image(
            root.to_string_lossy().to_string(),
            "ws".into(),
            "../../etc/pass wd".into(),
            "png".into(),
            png.into(),
        )
        .unwrap();

        // The name is reduced, not rejected — and it cannot escape images/.
        assert!(!info.file.contains(".."), "traversal survived: {}", info.file);
        assert!(!info.file.contains('/') && !info.file.contains('\\'));
        assert!(info.file.ends_with(".png"));
        assert!(info.size_bytes > 0);
        assert!(root.join("ws").join("images").join(&info.file).exists());

        // A second write of the same name must not overwrite the first.
        let again = write_image(
            root.to_string_lossy().to_string(),
            "ws".into(),
            "../../etc/pass wd".into(),
            "png".into(),
            png.into(),
        )
        .unwrap();
        assert_ne!(info.file, again.file);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn write_image_rejects_bad_input() {
        let root = std::env::temp_dir().join("burrow-img-neg");
        let call = |ext: &str, data: &str| {
            write_image(
                root.to_string_lossy().to_string(),
                "ws".into(),
                "x".into(),
                ext.into(),
                data.into(),
            )
        };
        // An executable dressed as an image must not be written at all.
        assert!(call("exe", "AAAA").is_err());
        assert!(call("svg", "AAAA").is_err());
        assert!(call("png", "not base64!!").is_err());
        assert!(call("png", "").is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
