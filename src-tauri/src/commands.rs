// Lightning FM — Tauri commands
// Callable from the React frontend via invoke().

use tauri::State;
use crate::node::{LdkState, NodeInfo, BalanceInfo, ChannelInfo};
use crate::identity::{IdentityState, IdentityInfo};
use nostr::prelude::*;

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

/// Check if there's a stored identity in the OS keychain.
/// Called on app launch to determine which onboarding path to show.
#[tauri::command]
pub fn identity_check(state: State<IdentityState>) -> Result<Option<IdentityInfo>, String> {
    let mut keys_lock = state.keys.lock().map_err(|e| e.to_string())?;

    // If already loaded in memory, return it
    if let Some(ref keys) = *keys_lock {
        return Ok(Some(crate::identity::IdentityInfo {
            npub: keys.public_key().to_bech32().unwrap_or_default(),
            pubkey_hex: keys.public_key().to_hex(),
            has_nsec: true,
            display_name: None,
        }));
    }

    // Try loading from keychain
    match crate::identity::load_identity_from_keychain()? {
        Some((keys, info)) => {
            *keys_lock = Some(keys);
            Ok(Some(info))
        }
        None => Ok(None), // No stored identity — show onboarding
    }
}

/// Create a new Nostr identity (keypair generation + keychain storage).
/// This is the "new to Nostr" onboarding path.
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

/// Import an existing nsec (bech32 or hex).
/// For users who already have a Nostr identity and want to bring it.
#[tauri::command]
pub fn identity_import(nsec: String, state: State<IdentityState>) -> Result<IdentityInfo, String> {
    let mut keys_lock = state.keys.lock().map_err(|e| e.to_string())?;

    let (keys, info) = crate::identity::import_nsec(&nsec)?;
    *keys_lock = Some(keys);
    Ok(info)
}

/// Export the nsec as bech32 for backup.
/// User explicitly requests this — we don't show it unprompted.
#[tauri::command]
pub fn identity_export_nsec(state: State<IdentityState>) -> Result<String, String> {
    let keys_lock = state.keys.lock().map_err(|e| e.to_string())?;

    match keys_lock.as_ref() {
        Some(keys) => crate::identity::export_nsec(keys),
        None => Err("No identity loaded".to_string()),
    }
}

/// Delete the stored identity from keychain and memory.
#[tauri::command]
pub fn identity_delete(state: State<IdentityState>) -> Result<String, String> {
    let mut keys_lock = state.keys.lock().map_err(|e| e.to_string())?;

    crate::identity::delete_identity()?;
    *keys_lock = None;
    Ok("Identity deleted".to_string())
}
