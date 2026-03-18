// Lightning FM — Tauri commands for LDK node interaction
// These are callable from the React frontend via invoke().

use tauri::State;
use crate::node::{LdkState, NodeInfo, BalanceInfo, ChannelInfo};

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
