// Lightning FM — Tauri backend entry point
// Manages LDK node, Nostr identity, relay connections, audio uploads, and playback.

mod node;
mod identity;
mod relay;
mod upload;
mod playback;
mod commands;

use tauri::Manager;
use node::LdkState;
use identity::IdentityState;
use relay::RelayState;
use commands::{
    // LDK node
    ldk_start, ldk_stop, ldk_get_info, ldk_get_balance, ldk_list_channels, ldk_new_address,
    // Nostr identity
    identity_check, identity_create, identity_import, identity_export_nsec, identity_delete,
    // Relay & browse
    relay_connect, browse_tracks,
    // Upload & publish
    upload_track,
    // Playback
    playback_fetch, playback_load_local, playback_cache_stats,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(LdkState::new())
        .manage(IdentityState::new())
        .manage(RelayState::new())
        .invoke_handler(tauri::generate_handler![
            // LDK node
            ldk_start,
            ldk_stop,
            ldk_get_info,
            ldk_get_balance,
            ldk_list_channels,
            ldk_new_address,
            // Nostr identity
            identity_check,
            identity_create,
            identity_import,
            identity_export_nsec,
            identity_delete,
            // Relay & browse
            relay_connect,
            browse_tracks,
            // Upload & publish
            upload_track,
            // Playback
            playback_fetch,
            playback_load_local,
            playback_cache_stats,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Lightning FM")
        .run(|app, event| {
            // Gracefully stop LDK node on app exit
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
