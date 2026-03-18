// Lightning FM — Tauri backend
// This is the Rust entry point. LDK node, Nostr identity, and Blossom
// server will be initialized here as we build out Phase 1.

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Welcome to Lightning FM, {}!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running Lightning FM");
}
