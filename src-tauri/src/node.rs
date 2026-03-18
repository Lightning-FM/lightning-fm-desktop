// Lightning FM — LDK Node lifecycle management
// Wraps ldk-node's Builder/Node into Tauri-friendly state and commands.

use ldk_node::{Builder, Node};
use ldk_node::bitcoin::Network;
use std::sync::{Arc, Mutex};
use std::path::PathBuf;
use serde::Serialize;

/// Shared state holding the LDK node instance
pub struct LdkState {
    pub node: Mutex<Option<Arc<Node>>>,
}

impl LdkState {
    pub fn new() -> Self {
        Self {
            node: Mutex::new(None),
        }
    }
}

/// Info returned by ldk_get_info
#[derive(Serialize)]
pub struct NodeInfo {
    pub node_id: String,
    pub network: String,
    pub listening_addresses: Vec<String>,
    pub num_channels: usize,
    pub num_peers: usize,
    pub is_running: bool,
}

/// Balance info returned by ldk_get_balance
#[derive(Serialize)]
pub struct BalanceInfo {
    pub total_onchain_sats: u64,
    pub spendable_onchain_sats: u64,
    pub total_lightning_sats: u64,
    pub outbound_capacity_sats: u64,
    pub inbound_capacity_sats: u64,
}

/// Channel info for list_channels
#[derive(Serialize)]
pub struct ChannelInfo {
    pub channel_id: String,
    pub peer_node_id: String,
    pub capacity_sats: u64,
    pub outbound_capacity_sats: u64,
    pub inbound_capacity_sats: u64,
    pub is_usable: bool,
    pub is_channel_ready: bool,
}

/// Returns the LDK data directory: ~/.lightning-fm/ldk/
fn data_dir() -> PathBuf {
    let home = dirs::home_dir().expect("Could not determine home directory");
    home.join(".lightning-fm").join("ldk")
}

/// Build and start the LDK node.
/// Uses testnet4 + Esplora for chain data, RapidGossipSync for routing.
pub fn start_node() -> Result<Arc<Node>, String> {
    let storage_dir = data_dir();
    std::fs::create_dir_all(&storage_dir)
        .map_err(|e| format!("Failed to create data dir: {}", e))?;

    let mut builder = Builder::new();
    builder.set_network(Network::Signet);
    builder.set_storage_dir_path(storage_dir.to_string_lossy().to_string());
    builder.set_chain_source_esplora(
        "https://mutinynet.ltbl.io/api".to_string(),
        None,
    );
    builder.set_gossip_source_rgs(
        "https://mutinynet.ltbl.io/snapshot".to_string(),
    );

    let node = builder.build().map_err(|e| format!("Failed to build node: {:?}", e))?;
    node.start().map_err(|e| format!("Failed to start node: {:?}", e))?;

    log::info!("LDK node started: {}", node.node_id());
    Ok(Arc::new(node))
}

/// Extract node info from a running node
pub fn get_node_info(node: &Node) -> NodeInfo {
    let channels = node.list_channels();
    let peers = node.list_peers();
    let addrs = node.listening_addresses()
        .unwrap_or_default()
        .iter()
        .map(|a| a.to_string())
        .collect();

    NodeInfo {
        node_id: node.node_id().to_string(),
        network: "signet".to_string(),
        listening_addresses: addrs,
        num_channels: channels.len(),
        num_peers: peers.len(),
        is_running: true,
    }
}

/// Extract balance details from a running node
pub fn get_balance(node: &Node) -> BalanceInfo {
    let balances = node.list_balances();
    let channels = node.list_channels();

    let outbound: u64 = channels.iter()
        .map(|c| c.outbound_capacity_msat / 1000)
        .sum();
    let inbound: u64 = channels.iter()
        .map(|c| c.inbound_capacity_msat / 1000)
        .sum();

    BalanceInfo {
        total_onchain_sats: balances.total_onchain_balance_sats,
        spendable_onchain_sats: balances.spendable_onchain_balance_sats,
        total_lightning_sats: balances.total_lightning_balance_sats,
        outbound_capacity_sats: outbound,
        inbound_capacity_sats: inbound,
    }
}

/// List all channels
pub fn list_channels(node: &Node) -> Vec<ChannelInfo> {
    node.list_channels()
        .iter()
        .map(|c| ChannelInfo {
            channel_id: format!("{}", c.channel_id),
            peer_node_id: c.counterparty_node_id.to_string(),
            capacity_sats: c.channel_value_sats,
            outbound_capacity_sats: c.outbound_capacity_msat / 1000,
            inbound_capacity_sats: c.inbound_capacity_msat / 1000,
            is_usable: c.is_usable,
            is_channel_ready: c.is_channel_ready,
        })
        .collect()
}
