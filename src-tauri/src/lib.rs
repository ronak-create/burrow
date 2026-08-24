mod keys;
mod speech;
mod workspace;

/// Frontend logging that reaches the terminal. The webview console is not visible
/// from outside the app window, so diagnostics route through here.
#[tauri::command]
fn log_line(level: String, message: String) {
    println!("[ui:{level}] {message}");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(speech::Speech::new())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Provider HTTP calls go through this plugin: it is not CORS-bound, which is
        // why this app needs no local relay proxy.
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            log_line,
            workspace::default_workspaces_root,
            workspace::list_workspaces,
            workspace::create_workspace,
            workspace::read_workspace,
            workspace::update_workspace_meta,
            workspace::read_board,
            workspace::write_board,
            workspace::append_transcript,
            workspace::read_transcript,
            workspace::delete_workspace,
            keys::set_api_key,
            keys::get_api_key,
            keys::has_api_key,
            keys::delete_api_key,
            keys::configured_providers,
            speech::speech_available,
            speech::speak,
            speech::stop_speaking,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
