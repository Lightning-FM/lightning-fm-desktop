// Lightning FM — Tauri backend entry point
// Manages LDK node lifecycle and exposes commands to the React frontend.

mod node;
mod commands;

use node::LdkState;
use commands::{ldk_start, ldk_stop, ldk_get_info, ldk_get_balance, ldk_list_channels, ldk_new_address};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(LdkState::new())
        .invoke_handler(tauri::generate_handler![
            ldk_start,
            ldk_stop,
            ldk_get_info,
            ldk_get_balance,
            ldk_list_channels,
            ldk_new_address,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lightning FM");
}
