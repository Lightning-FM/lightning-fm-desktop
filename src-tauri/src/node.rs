// Lightning FM — LDK Node lifecycle management
// Wraps ldk-node's Builder/Node into Tauri-friendly state and commands.

use ldk_node::{Builder, Node};
use ldk_node::bitcoin::Network;
use ldk_node::lightning::ln::msgs::SocketAddress;
use std::sync::{Arc, Mutex};
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tokio::sync::watch;

/// Shared state holding the LDK node instance and event loop handle
pub struct LdkState {
    pub node: Mutex<Option<Arc<Node>>>,
    /// Send `true` to shut down the event loop
    pub event_shutdown: Mutex<Option<watch::Sender<bool>>>,
}

impl LdkState {
    pub fn new() -> Self {
        Self {
            node: Mutex::new(None),
            event_shutdown: Mutex::new(None),
        }
    }
}

/// LSPS2 LSP configuration
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LspConfig {
    /// LSP node address (e.g., "44.228.24.253:9735")
    pub address: String,
    /// LSP node public key (hex-encoded)
    pub node_id: String,
    /// Optional access token for the LSP
    pub token: Option<String>,
}

/// Configuration for node startup
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NodeConfig {
    /// Enable artist mode — opens a listening port for inbound connections
    pub artist_mode: bool,
    /// Port to listen on in artist mode (default: 9735)
    pub listening_port: Option<u16>,
    /// LSPS2 LSP configuration (uses Mutinynet default if not provided)
    pub lsp: Option<LspConfig>,
}

impl Default for NodeConfig {
    fn default() -> Self {
        Self {
            artist_mode: false,
            listening_port: None,
            lsp: None,
        }
    }
}

// Mutinynet LSPS2 LSP — LTBL (Let There Be Lightning) signet node
const DEFAULT_LSP_ADDRESS: &str = "44.228.24.253:9735";
const DEFAULT_LSP_NODE_ID: &str = "0371d6fd7d75de2d0372d03ea00e8bacdacb50c27d0eaea0a76a0622eff1f5ef2b";

/// Default listening port for artist mode
const DEFAULT_LISTENING_PORT: u16 = 9735;

/// Returns the LDK data directory: ~/.lightning-fm/ldk/
fn data_dir() -> PathBuf {
    let home = dirs::home_dir().expect("Could not determine home directory");
    home.join(".lightning-fm").join("ldk")
}

/// Parse an LSP config into the types ldk-node expects.
/// Separated from Builder calls so it's testable.
pub fn parse_lsp_config(lsp: &LspConfig) -> Result<(SocketAddress, ldk_node::bitcoin::secp256k1::PublicKey, Option<String>), String> {
    let address: SocketAddress = lsp.address.parse()
        .map_err(|_| format!("Invalid LSP address: {}", lsp.address))?;

    let node_id: ldk_node::bitcoin::secp256k1::PublicKey = lsp.node_id.parse()
        .map_err(|_| format!("Invalid LSP node ID: {}", lsp.node_id))?;

    Ok((address, node_id, lsp.token.clone()))
}

/// Parse a listening address for artist mode.
pub fn parse_listening_address(port: u16) -> Result<SocketAddress, String> {
    let addr_str = format!("0.0.0.0:{}", port);
    addr_str.parse()
        .map_err(|_| format!("Invalid listening address: {}", addr_str))
}

/// Resolve the LSP config: use provided config or fall back to Mutinynet default.
pub fn resolve_lsp_config(config: &NodeConfig) -> LspConfig {
    config.lsp.clone().unwrap_or(LspConfig {
        address: DEFAULT_LSP_ADDRESS.to_string(),
        node_id: DEFAULT_LSP_NODE_ID.to_string(),
        token: None,
    })
}

/// Build and start the LDK node.
/// Uses Signet + Esplora for chain data, RapidGossipSync for routing.
/// Configures LSPS2 for inbound liquidity and optional listening for artist mode.
pub fn start_node(config: &NodeConfig) -> Result<Arc<Node>, String> {
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

    // LSPS2 — JIT inbound liquidity from LSP
    let lsp = resolve_lsp_config(config);
    let (lsp_addr, lsp_pubkey, lsp_token) = parse_lsp_config(&lsp)?;
    builder.set_liquidity_source_lsps2(lsp_addr, lsp_pubkey, lsp_token);
    log::info!("LSPS2 configured: {} @ {}", lsp.node_id, lsp.address);

    // Artist mode — listen for inbound peer connections (needed for keysend receiving)
    if config.artist_mode {
        let port = config.listening_port.unwrap_or(DEFAULT_LISTENING_PORT);
        let listen_addr = parse_listening_address(port)?;
        builder.set_listening_addresses(vec![listen_addr.clone()])
            .map_err(|e| format!("Failed to set listening address: {:?}", e))?;
        log::info!("Artist mode: listening on {}", listen_addr);
    }

    let node = builder.build().map_err(|e| format!("Failed to build node: {:?}", e))?;
    node.start().map_err(|e| format!("Failed to start node: {:?}", e))?;

    log::info!("LDK node started: {}", node.node_id());
    Ok(Arc::new(node))
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
    pub artist_mode: bool,
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

/// Extract node info from a running node
pub fn get_node_info(node: &Node, artist_mode: bool) -> NodeInfo {
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
        artist_mode,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_is_listener_mode() {
        let config = NodeConfig::default();
        assert!(!config.artist_mode);
        assert!(config.listening_port.is_none());
        assert!(config.lsp.is_none());
    }

    #[test]
    fn resolve_lsp_uses_default_when_none() {
        let config = NodeConfig::default();
        let lsp = resolve_lsp_config(&config);
        assert_eq!(lsp.address, DEFAULT_LSP_ADDRESS);
        assert_eq!(lsp.node_id, DEFAULT_LSP_NODE_ID);
        assert!(lsp.token.is_none());
    }

    #[test]
    fn resolve_lsp_uses_custom_when_provided() {
        let config = NodeConfig {
            lsp: Some(LspConfig {
                address: "10.0.0.1:9736".to_string(),
                node_id: "02".to_string() + &"ab".repeat(32),
                token: Some("my-token".to_string()),
            }),
            ..Default::default()
        };
        let lsp = resolve_lsp_config(&config);
        assert_eq!(lsp.address, "10.0.0.1:9736");
        assert_eq!(lsp.token, Some("my-token".to_string()));
    }

    #[test]
    fn parse_lsp_config_valid() {
        let lsp = LspConfig {
            address: DEFAULT_LSP_ADDRESS.to_string(),
            node_id: DEFAULT_LSP_NODE_ID.to_string(),
            token: None,
        };
        let result = parse_lsp_config(&lsp);
        assert!(result.is_ok(), "Failed to parse default LSP config: {:?}", result.err());

        let (addr, pubkey, token) = result.unwrap();
        assert!(addr.to_string().contains("44.228.24.253"));
        assert_eq!(pubkey.to_string(), DEFAULT_LSP_NODE_ID);
        assert!(token.is_none());
    }

    #[test]
    fn parse_lsp_config_invalid_address() {
        let lsp = LspConfig {
            address: "not-an-address".to_string(),
            node_id: DEFAULT_LSP_NODE_ID.to_string(),
            token: None,
        };
        let result = parse_lsp_config(&lsp);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid LSP address"));
    }

    #[test]
    fn parse_lsp_config_invalid_node_id() {
        let lsp = LspConfig {
            address: DEFAULT_LSP_ADDRESS.to_string(),
            node_id: "not-a-pubkey".to_string(),
            token: None,
        };
        let result = parse_lsp_config(&lsp);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid LSP node ID"));
    }

    #[test]
    fn parse_lsp_config_with_token() {
        let lsp = LspConfig {
            address: DEFAULT_LSP_ADDRESS.to_string(),
            node_id: DEFAULT_LSP_NODE_ID.to_string(),
            token: Some("test-token-123".to_string()),
        };
        let (_, _, token) = parse_lsp_config(&lsp).unwrap();
        assert_eq!(token, Some("test-token-123".to_string()));
    }

    #[test]
    fn parse_listening_address_valid() {
        let result = parse_listening_address(9735);
        assert!(result.is_ok());
        assert!(result.unwrap().to_string().contains("9735"));
    }

    #[test]
    fn parse_listening_address_custom_port() {
        let result = parse_listening_address(19735);
        assert!(result.is_ok());
        assert!(result.unwrap().to_string().contains("19735"));
    }

    #[test]
    fn node_config_serializes() {
        let config = NodeConfig {
            artist_mode: true,
            listening_port: Some(9736),
            lsp: Some(LspConfig {
                address: "1.2.3.4:9735".to_string(),
                node_id: "02abcd".to_string(),
                token: None,
            }),
        };
        let json = serde_json::to_string(&config).unwrap();
        assert!(json.contains("artist_mode"));
        assert!(json.contains("9736"));
    }

    #[test]
    fn node_config_deserializes_from_frontend() {
        let json = r#"{"artist_mode": true}"#;
        let config: NodeConfig = serde_json::from_str(json).unwrap();
        assert!(config.artist_mode);
        assert!(config.listening_port.is_none());
        assert!(config.lsp.is_none());
    }
}
