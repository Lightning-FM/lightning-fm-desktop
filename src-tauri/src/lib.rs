// Lightning FM — Tauri backend entry point
// Manages LDK node lifecycle and exposes commands to the React frontend.

mod node;
mod commands;

use tauri::Manager;
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
        .build(tauri::generate_context!())
        .expect("error while building Lightning FM")
        .run(|app, event| {
            // Gracefully stop LDK node on app exit to prevent dirty channel state.
            // Unclean shutdown risks missing justice transactions if a peer force-closes.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let state = app.state::<LdkState>();
                if let Ok(mut lock) = state.inner().node.lock() {
                    if let Some(node) = lock.take() {
                        let _: Result<(), _> = node.stop();
                        log::info!("LDK node stopped on app exit");
                    }
                }
            }
        });
}
