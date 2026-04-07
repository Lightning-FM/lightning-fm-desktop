// Lightning FM — Tauri backend entry point

mod node;
mod identity;
mod relay;
mod upload;
mod playback;
mod credits;
mod streaming;
mod events;
mod metadata;
mod waveform;
mod commands;

use tauri::Manager;
use node::LdkState;
use identity::IdentityState;
use relay::RelayState;
use credits::CreditsState;
use streaming::StreamingState;
use commands::{
    // LDK node
    ldk_start, ldk_stop, ldk_get_info, ldk_get_balance, ldk_list_channels, ldk_new_address,
    // Nostr identity
    identity_check, identity_create, identity_import, identity_export_nsec, identity_delete,
    // Relay & browse
    relay_connect, browse_tracks,
    // Profile
    profile_fetch, profile_set,
    // Upload & publish
    upload_track,
    // Metadata & waveform
    metadata_read, metadata_write, artwork_extract, waveform_generate,
    // Withdrawals
    withdraw_lightning, withdraw_onchain,
    // Playback
    playback_fetch, playback_load_local, playback_read_audio, playback_cache_stats, playback_start,
    catalog_load_batch,
    // Credits
    credits_info, credits_deduct,
    // Streaming payments
    stream_start, stream_tick, stream_pause, stream_resume, stream_stop, stream_info,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(LdkState::new())
        .manage(IdentityState::new())
        .manage(RelayState::new())
        .manage(CreditsState::new())
        .manage(StreamingState::new())
        .invoke_handler(tauri::generate_handler![
            // LDK node
            ldk_start, ldk_stop, ldk_get_info, ldk_get_balance, ldk_list_channels, ldk_new_address,
            // Nostr identity
            identity_check, identity_create, identity_import, identity_export_nsec, identity_delete,
            // Relay & browse
            relay_connect, browse_tracks,
            // Profile
            profile_fetch, profile_set,
            // Upload & publish
            upload_track,
            // Metadata & waveform
            metadata_read, metadata_write, artwork_extract, waveform_generate,
            // Withdrawals
            withdraw_lightning, withdraw_onchain,
            // Playback
            playback_fetch, playback_load_local, playback_read_audio, playback_cache_stats, playback_start,
            catalog_load_batch,
            // Credits
            credits_info, credits_deduct,
            // Streaming payments
            stream_start, stream_tick, stream_pause, stream_resume, stream_stop, stream_info,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Lightning FM")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let state = app.state::<LdkState>();

                // Signal the event loop to stop first
                if let Ok(mut shutdown_lock) = state.inner().event_shutdown.lock() {
                    if let Some(tx) = shutdown_lock.take() {
                        let _ = tx.send(true);
                        log::info!("LDK event loop shutdown signaled");
                    }
                }

                // Then stop the node.
                if let Ok(mut lock) = state.inner().node.lock() {
                    if let Some(node) = lock.take() {
                        match node.stop() {
                            Ok(()) => log::info!("LDK node stopped on app exit"),
                            Err(e) => log::error!("LDK node stop failed: {:?}", e),
                        }
                    }
                }
            }
        });
}
