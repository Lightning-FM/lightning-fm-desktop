// Lightning FM — Tauri commands
// Callable from the React frontend via invoke().

use tauri::State;
use crate::node::{LdkState, NodeInfo, BalanceInfo, ChannelInfo};
use crate::identity::{IdentityState, IdentityInfo};
use crate::relay::{RelayState, TrackInfo};
use nostr_sdk::prelude::*;
use std::path::Path;

// ─── LDK Node Commands ──────────────────────────────────────

#[tauri::command]
pub fn ldk_start(state: State<LdkState>) -> Result<NodeInfo, String> {
    let mut node_lock = state.node.lock().map_err(|e| e.to_string())?;

    if node_lock.is_some() {
        return Err("Node is already running".to_string());
    }

    let node = crate::node::start_node()?;
    let info = crate::node::get_node_info(&node);
    *node_lock = Some(node);
    Ok(info)
}

#[tauri::command]
pub fn ldk_stop(state: State<LdkState>) -> Result<String, String> {
    let mut node_lock = state.node.lock().map_err(|e| e.to_string())?;

    match node_lock.take() {
        Some(node) => {
            node.stop().map_err(|e| format!("Failed to stop node: {:?}", e))?;
            Ok("Node stopped".to_string())
        }
        None => Err("Node is not running".to_string()),
    }
}

#[tauri::command]
pub fn ldk_get_info(state: State<LdkState>) -> Result<NodeInfo, String> {
    let node_lock = state.node.lock().map_err(|e| e.to_string())?;

    match node_lock.as_ref() {
        Some(node) => Ok(crate::node::get_node_info(node)),
        None => Err("Node is not running".to_string()),
    }
}

#[tauri::command]
pub fn ldk_get_balance(state: State<LdkState>) -> Result<BalanceInfo, String> {
    let node_lock = state.node.lock().map_err(|e| e.to_string())?;

    match node_lock.as_ref() {
        Some(node) => Ok(crate::node::get_balance(node)),
        None => Err("Node is not running".to_string()),
    }
}

#[tauri::command]
pub fn ldk_list_channels(state: State<LdkState>) -> Result<Vec<ChannelInfo>, String> {
    let node_lock = state.node.lock().map_err(|e| e.to_string())?;

    match node_lock.as_ref() {
        Some(node) => Ok(crate::node::list_channels(node)),
        None => Err("Node is not running".to_string()),
    }
}

#[tauri::command]
pub fn ldk_new_address(state: State<LdkState>) -> Result<String, String> {
    let node_lock = state.node.lock().map_err(|e| e.to_string())?;

    match node_lock.as_ref() {
        Some(node) => {
            let addr = node.onchain_payment().new_address()
                .map_err(|e| format!("Failed to generate address: {:?}", e))?;
            Ok(addr.to_string())
        }
        None => Err("Node is not running".to_string()),
    }
}

// ─── Nostr Identity Commands ────────────────────────────────

#[tauri::command]
pub fn identity_check(state: State<IdentityState>) -> Result<Option<IdentityInfo>, String> {
    let mut keys_lock = state.keys.lock().map_err(|e| e.to_string())?;

    if let Some(ref keys) = *keys_lock {
        return Ok(Some(crate::identity::IdentityInfo {
            npub: keys.public_key().to_bech32().unwrap_or_default(),
            pubkey_hex: keys.public_key().to_hex(),
            has_nsec: true,
            display_name: None,
        }));
    }

    match crate::identity::load_identity_from_keychain()? {
        Some((keys, info)) => {
            *keys_lock = Some(keys);
            Ok(Some(info))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn identity_create(state: State<IdentityState>) -> Result<IdentityInfo, String> {
    let mut keys_lock = state.keys.lock().map_err(|e| e.to_string())?;

    if keys_lock.is_some() {
        return Err("Identity already exists. Delete first to create a new one.".to_string());
    }

    let (keys, info) = crate::identity::create_identity()?;
    *keys_lock = Some(keys);
    Ok(info)
}

#[tauri::command]
pub fn identity_import(nsec: String, state: State<IdentityState>) -> Result<IdentityInfo, String> {
    let mut keys_lock = state.keys.lock().map_err(|e| e.to_string())?;

    let (keys, info) = crate::identity::import_nsec(&nsec)?;
    *keys_lock = Some(keys);
    Ok(info)
}

#[tauri::command]
pub fn identity_export_nsec(state: State<IdentityState>) -> Result<String, String> {
    let keys_lock = state.keys.lock().map_err(|e| e.to_string())?;

    match keys_lock.as_ref() {
        Some(keys) => crate::identity::export_nsec(keys),
        None => Err("No identity loaded".to_string()),
    }
}

#[tauri::command]
pub fn identity_delete(state: State<IdentityState>) -> Result<String, String> {
    let mut keys_lock = state.keys.lock().map_err(|e| e.to_string())?;

    crate::identity::delete_identity()?;
    *keys_lock = None;
    Ok("Identity deleted".to_string())
}

// ─── Relay & Browse Commands ────────────────────────────────

/// Connect to Nostr relays. Requires an identity to be loaded.
#[tauri::command]
pub async fn relay_connect(
    identity_state: State<'_, IdentityState>,
    relay_state: State<'_, RelayState>,
) -> Result<String, String> {
    let keys = {
        let keys_lock = identity_state.keys.lock().map_err(|e| e.to_string())?;
        keys_lock.clone().ok_or("No identity loaded. Create or import one first.")?
    };

    let client = crate::relay::connect(&keys).await?;
    let mut client_lock = relay_state.client.lock().await;
    *client_lock = Some(client);

    Ok("Connected to relays".to_string())
}

/// Fetch all tracks from connected relays
#[tauri::command]
pub async fn browse_tracks(
    relay_state: State<'_, RelayState>,
) -> Result<Vec<TrackInfo>, String> {
    let client_lock = relay_state.client.lock().await;

    match client_lock.as_ref() {
        Some(client) => crate::relay::fetch_tracks(client).await,
        None => Err("Not connected to relays. Call relay_connect first.".to_string()),
    }
}

// ─── Upload & Publish Commands ──────────────────────────────

/// Upload an audio file to Blossom and publish track metadata to Nostr.
/// This is the artist upload flow: file → SHA-256 → Blossom → kind 31337.
#[tauri::command]
pub async fn upload_track(
    file_path: String,
    title: String,
    slug: String,
    duration_secs: Option<u64>,
    preview_secs: Option<u64>,
    identity_state: State<'_, IdentityState>,
    relay_state: State<'_, RelayState>,
) -> Result<TrackInfo, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    // Get keys for Blossom auth and event signing
    let keys = {
        let keys_lock = identity_state.keys.lock().map_err(|e| e.to_string())?;
        keys_lock.clone().ok_or("No identity loaded")?
    };

    // Upload to Blossom
    let upload = crate::upload::upload_to_blossom(path, &keys).await?;

    // Publish kind 31337 to relays
    let client_lock = relay_state.client.lock().await;
    let client = client_lock.as_ref()
        .ok_or("Not connected to relays")?;

    let event_id = crate::relay::publish_track(
        client,
        &title,
        &slug,
        duration_secs,
        &upload.sha256,
        &upload.url,
        None, // fallback_url — artist is the primary source
        &upload.mime_type,
        upload.size,
        preview_secs,
    ).await?;

    Ok(TrackInfo {
        event_id,
        artist_pubkey: keys.public_key().to_hex(),
        artist_npub: keys.public_key().to_bech32().unwrap_or_default(),
        title,
        slug,
        duration_secs,
        audio_hash: Some(upload.sha256),
        audio_url: Some(upload.url),
        fallback_url: None,
        mime_type: Some(upload.mime_type),
        file_size: Some(upload.size),
        preview_secs,
        created_at: nostr_sdk::Timestamp::now().as_u64(),
    })
}
