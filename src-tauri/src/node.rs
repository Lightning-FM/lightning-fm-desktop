// Lightning FM — LDK Node lifecycle management
// Wraps ldk-node's Builder/Node into Tauri-friendly state and commands.

use ldk_node::{Builder, Node};
use ldk_node::bip39::Mnemonic;
use ldk_node::bitcoin::Network;
use ldk_node::lightning::ln::msgs::SocketAddress;
use keyring::Entry;
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

// ─── Environment-driven dev-mode config ────────────────────
//
// When LFM_NETWORK=regtest is set, the desktop app targets a local dev
// cluster (see lightning-fm/infra/dev-cluster/). Signet + Mutinynet remain
// the default when LFM_NETWORK is unset or any other value.

/// Read LFM_NETWORK from env. Defaults to Signet (production/Mutinynet path).
pub fn network_from_env() -> Network {
    match std::env::var("LFM_NETWORK").ok().as_deref() {
        Some("regtest") => Network::Regtest,
        Some("testnet") => Network::Testnet,
        Some("bitcoin") | Some("mainnet") => Network::Bitcoin,
        _ => Network::Signet,
    }
}

/// Read LFM_LSP_* env vars. Returns None if either NODE_ID or ADDRESS is missing,
/// so callers fall through to the Mutinynet default.
pub fn lsp_from_env() -> Option<LspConfig> {
    let node_id = std::env::var("LFM_LSP_NODE_ID").ok()?;
    let address = std::env::var("LFM_LSP_ADDRESS").ok()?;
    if node_id.is_empty() || address.is_empty() {
        return None;
    }
    Some(LspConfig {
        node_id,
        address,
        token: std::env::var("LFM_LSP_TOKEN").ok(),
    })
}

/// Parsed bitcoind RPC URL pieces for ldk-node's set_chain_source_bitcoind_rpc.
#[derive(Clone, Debug)]
pub struct BitcoindRpcConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub pass: String,
}

/// Parse LFM_BITCOIND_RPC_URL (http://user:pass@host:port). None if unset/invalid.
pub fn bitcoind_rpc_from_env() -> Option<BitcoindRpcConfig> {
    let url = std::env::var("LFM_BITCOIND_RPC_URL").ok()?;
    let without_scheme = url.strip_prefix("http://").or_else(|| url.strip_prefix("https://"))?;
    let (creds, host_port) = without_scheme.split_once('@')?;
    let (user, pass) = creds.split_once(':')?;
    let (host, port_str) = host_port.split_once(':')?;
    let port: u16 = port_str.parse().ok()?;
    Some(BitcoindRpcConfig {
        host: host.to_string(),
        port,
        user: user.to_string(),
        pass: pass.to_string(),
    })
}

/// Chain source decided at `ldk_start` time. Esplora+RGS for signet, bitcoind
/// RPC for regtest. `prepare_chain_source()` picks the right one.
#[derive(Clone, Debug)]
pub enum ChainSourceConfig {
    Esplora { esplora_url: String, rgs_url: String },
    BitcoindRpc(BitcoindRpcConfig),
}

/// Decide the chain source based on LFM_NETWORK + env. Async because the
/// signet path does HTTP health checks against Esplora.
pub async fn prepare_chain_source() -> Result<ChainSourceConfig, String> {
    match network_from_env() {
        Network::Regtest => {
            let rpc = bitcoind_rpc_from_env().ok_or_else(|| {
                "LFM_NETWORK=regtest requires LFM_BITCOIND_RPC_URL=http://user:pass@host:port".to_string()
            })?;
            log::info!("Chain source: bitcoind RPC at {}:{}", rpc.host, rpc.port);
            Ok(ChainSourceConfig::BitcoindRpc(rpc))
        }
        _ => {
            let (esplora_url, rgs_url) = find_healthy_endpoint().await?;
            Ok(ChainSourceConfig::Esplora { esplora_url, rgs_url })
        }
    }
}

/// Returns the LDK data directory. Signet stays at ~/.lightning-fm/ldk/ for
/// backward compatibility with existing users. Other networks get a subpath
/// so you can flip between regtest and signet without corrupting state.
fn data_dir() -> PathBuf {
    let home = dirs::home_dir().expect("Could not determine home directory");
    let base = home.join(".lightning-fm").join("ldk");
    match network_from_env() {
        Network::Signet => base,
        Network::Regtest => base.join("regtest"),
        Network::Testnet => base.join("testnet"),
        Network::Bitcoin => base.join("mainnet"),
        _ => base,
    }
}

// ─── BIP39 mnemonic + Keychain management ──────────────────

const KEYRING_SERVICE: &str = "fm.lightning.desktop";
const KEYRING_LDK_MNEMONIC: &str = "ldk-mnemonic";

/// Check if an LDK seed file already exists on disk (created by a previous
/// run before mnemonic backup was implemented).
fn has_legacy_seed_file() -> bool {
    data_dir().join("keys_seed").exists()
}

/// Load mnemonic from macOS Keychain.
/// Returns Ok(Some(mnemonic)) if found, Ok(None) if no entry, Err on failure.
pub fn load_mnemonic_from_keychain() -> Result<Option<Mnemonic>, String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_LDK_MNEMONIC)
        .map_err(|e| format!("Keyring access error: {}", e))?;

    match entry.get_password() {
        Ok(phrase) => {
            let mnemonic: Mnemonic = phrase.parse()
                .map_err(|e| format!("Invalid stored mnemonic: {}", e))?;
            Ok(Some(mnemonic))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Keyring read error: {}", e)),
    }
}

/// Store mnemonic in macOS Keychain.
fn store_mnemonic_in_keychain(mnemonic: &Mnemonic) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_LDK_MNEMONIC)
        .map_err(|e| format!("Keyring access error: {}", e))?;

    entry.set_password(&mnemonic.to_string())
        .map_err(|e| format!("Failed to store mnemonic in keychain: {}", e))?;

    Ok(())
}

/// Load an existing mnemonic from Keychain, or generate a new one and store it.
/// Returns None if a legacy seed file exists without a Keychain backup — the
/// node will fall back to the on-disk seed in that case.
fn load_or_create_mnemonic() -> Result<Option<Mnemonic>, String> {
    // Check Keychain first
    if let Some(mnemonic) = load_mnemonic_from_keychain()? {
        log::info!("LDK mnemonic loaded from Keychain");
        return Ok(Some(mnemonic));
    }

    // No mnemonic in Keychain — check if there's a legacy seed on disk
    if has_legacy_seed_file() {
        log::warn!(
            "Legacy LDK seed file found at {:?} but no mnemonic in Keychain. \
             The node will start using the on-disk seed, but it is NOT backed up. \
             Consider re-creating your Lightning identity to enable mnemonic backup.",
            data_dir().join("keys_seed")
        );
        return Ok(None);
    }

    // Fresh install — generate a new mnemonic
    let mnemonic = ldk_node::generate_entropy_mnemonic(None);
    store_mnemonic_in_keychain(&mnemonic)?;
    log::info!("New LDK mnemonic generated and stored in Keychain");
    Ok(Some(mnemonic))
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

/// Resolve the LSP config. Preference order:
///   1. Explicit `NodeConfig.lsp` (from frontend)
///   2. LFM_LSP_* env vars (dev cluster or custom LSP)
///   3. Mutinynet LTBL default (shipping production default)
pub fn resolve_lsp_config(config: &NodeConfig) -> LspConfig {
    if let Some(lsp) = config.lsp.clone() {
        return lsp;
    }
    if let Some(lsp) = lsp_from_env() {
        return lsp;
    }
    LspConfig {
        address: DEFAULT_LSP_ADDRESS.to_string(),
        node_id: DEFAULT_LSP_NODE_ID.to_string(),
        token: None,
    }
}

/// Esplora endpoints to try in order. If the primary is down, we fall back.
const ESPLORA_ENDPOINTS: &[(&str, &str)] = &[
    ("https://mutinynet.ltbl.io/api", "https://mutinynet.ltbl.io/snapshot"),
    ("https://mutinynet.com/api", "https://mutinynet.ltbl.io/snapshot"),
    ("https://mempool.space/signet/api", "https://mutinynet.ltbl.io/snapshot"),
];

/// Check if an Esplora endpoint is healthy by hitting its fee-estimates endpoint.
/// Async — safe to call from Tauri's async command handlers.
pub async fn check_esplora_health(base_url: &str) -> bool {
    let url = format!("{}/fee-estimates", base_url);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build();

    match client {
        Ok(c) => match c.get(&url).send().await {
            Ok(resp) => {
                let healthy = resp.status().is_success();
                if !healthy {
                    log::warn!("Esplora {} returned HTTP {}", base_url, resp.status());
                }
                healthy
            }
            Err(e) => {
                log::warn!("Esplora {} unreachable: {}", base_url, e);
                false
            }
        },
        Err(_) => false,
    }
}

/// Find the first healthy Esplora endpoint. Async — call before start_node.
pub async fn find_healthy_endpoint() -> Result<(String, String), String> {
    for (esplora_url, rgs_url) in ESPLORA_ENDPOINTS {
        log::info!("Checking Esplora health: {}", esplora_url);
        if check_esplora_health(esplora_url).await {
            log::info!("Using Esplora endpoint: {}", esplora_url);
            return Ok((esplora_url.to_string(), rgs_url.to_string()));
        }
    }
    Err("All Esplora endpoints are unreachable".to_string())
}

/// Build and start the LDK node with a pre-decided chain source.
/// Call `prepare_chain_source()` first to get the ChainSourceConfig.
/// This is a blocking function — call from spawn_blocking if in async context.
pub fn start_node(config: &NodeConfig, chain_source: &ChainSourceConfig) -> Result<Arc<Node>, String> {
    let network = network_from_env();
    let storage_dir = data_dir();
    std::fs::create_dir_all(&storage_dir)
        .map_err(|e| format!("Failed to create data dir: {}", e))?;

    let lsp = resolve_lsp_config(config);
    let (lsp_addr, lsp_pubkey, lsp_token) = parse_lsp_config(&lsp)?;

    // Load or create mnemonic for seed derivation
    let mnemonic = load_or_create_mnemonic()?;

    let mut builder = Builder::new();
    builder.set_network(network);
    builder.set_storage_dir_path(storage_dir.to_string_lossy().to_string());

    if let Some(m) = mnemonic {
        builder.set_entropy_bip39_mnemonic(m, None);
        log::info!("LDK node configured with BIP39 mnemonic seed");
    } else {
        log::warn!("LDK node using legacy on-disk seed (no mnemonic backup)");
    }

    match chain_source {
        ChainSourceConfig::Esplora { esplora_url, rgs_url } => {
            builder.set_chain_source_esplora(esplora_url.clone(), None);
            builder.set_gossip_source_rgs(rgs_url.clone());
            log::info!("Chain source: Esplora {}", esplora_url);
        }
        ChainSourceConfig::BitcoindRpc(rpc) => {
            builder.set_chain_source_bitcoind_rpc(
                rpc.host.clone(),
                rpc.port,
                rpc.user.clone(),
                rpc.pass.clone(),
            );
            // No RGS on regtest — no public gossip graph exists.
            log::info!("Chain source: bitcoind RPC {}:{}", rpc.host, rpc.port);
        }
    }

    builder.set_liquidity_source_lsps2(lsp_pubkey, lsp_addr, lsp_token);
    log::info!("LSPS2 configured: {} @ {}", lsp.node_id, lsp.address);

    if config.artist_mode {
        let port = config.listening_port.unwrap_or(DEFAULT_LISTENING_PORT);
        let listen_addr = parse_listening_address(port)?;
        builder.set_listening_addresses(vec![listen_addr.clone()])
            .map_err(|e| format!("Failed to set listening address: {:?}", e))?;
        log::info!("Artist mode: listening on {}", listen_addr);
    }

    let node = builder.build().map_err(|e| format!("Failed to build node: {:?}", e))?;
    node.start().map_err(|e| format!("Failed to start node: {:?}", e))?;

    log::info!("LDK node started on {:?}: {}", network, node.node_id());
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
        network: network_from_env().to_string(),
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
    fn esplora_endpoints_has_at_least_two() {
        assert!(ESPLORA_ENDPOINTS.len() >= 2, "Need at least a primary and fallback endpoint");
    }

    #[test]
    fn esplora_endpoints_are_https() {
        for (esplora, rgs) in ESPLORA_ENDPOINTS {
            assert!(esplora.starts_with("https://"), "Esplora URL must be HTTPS: {}", esplora);
            assert!(rgs.starts_with("https://"), "RGS URL must be HTTPS: {}", rgs);
        }
    }

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

    // ─── Esplora health check + fallback tests ──────────────

    #[tokio::test]
    async fn health_check_returns_false_for_unreachable_host() {
        let result = check_esplora_health("https://this-host-does-not-exist.invalid/api").await;
        assert!(!result);
    }

    #[tokio::test]
    async fn health_check_returns_false_for_non_json_endpoint() {
        // Valid host, but not an Esplora API — fee-estimates path won't exist
        let result = check_esplora_health("https://example.com").await;
        assert!(!result);
    }

    #[tokio::test]
    async fn health_check_returns_true_for_known_good_endpoint() {
        // mempool.space signet is a stable public endpoint
        let result = check_esplora_health("https://mempool.space/signet/api").await;
        assert!(result, "mempool.space signet should be healthy");
    }

    #[tokio::test]
    async fn find_healthy_endpoint_returns_a_result() {
        // At least one of the configured endpoints should be up
        let result = find_healthy_endpoint().await;
        assert!(result.is_ok(), "Should find at least one healthy endpoint: {:?}", result.err());

        let (esplora, rgs) = result.unwrap();
        assert!(esplora.starts_with("https://"));
        assert!(rgs.starts_with("https://"));
    }

    #[tokio::test]
    async fn find_healthy_endpoint_returns_first_healthy() {
        // If the first endpoint is healthy, it should be returned
        // (we can't control which is up, but we verify the contract)
        let result = find_healthy_endpoint().await.unwrap();
        // Result should be one of our configured endpoints
        let valid_urls: Vec<&str> = ESPLORA_ENDPOINTS.iter().map(|(url, _)| *url).collect();
        assert!(valid_urls.contains(&result.0.as_str()),
            "Returned URL {} should be from configured endpoints", result.0);
    }

    #[test]
    fn esplora_endpoints_have_unique_base_urls() {
        let urls: Vec<&str> = ESPLORA_ENDPOINTS.iter().map(|(url, _)| *url).collect();
        let unique: std::collections::HashSet<&&str> = urls.iter().collect();
        assert_eq!(urls.len(), unique.len(), "Esplora endpoints should be unique");
    }

    #[test]
    fn start_node_rejects_invalid_esplora_url() {
        // start_node should fail gracefully with a bad URL, not panic
        let config = NodeConfig::default();
        let chain = ChainSourceConfig::Esplora {
            esplora_url: "not-a-url".to_string(),
            rgs_url: "also-not-a-url".to_string(),
        };
        let result = start_node(&config, &chain);
        assert!(result.is_err());
    }

    // ─── Env-driven dev-mode config tests ───────────────────
    //
    // These mutate process env, which is global. Tests in this module
    // serialize via a mutex so they don't race with each other or with
    // other integration tests that care about LFM_* vars.

    use std::sync::Mutex;
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn with_env<F: FnOnce()>(vars: &[(&str, Option<&str>)], f: F) {
        let _guard = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let prev: Vec<(String, Option<String>)> = vars.iter()
            .map(|(k, _)| (k.to_string(), std::env::var(k).ok()))
            .collect();
        for (k, v) in vars {
            match v {
                Some(val) => std::env::set_var(k, val),
                None => std::env::remove_var(k),
            }
        }
        f();
        for (k, v) in prev {
            match v {
                Some(val) => std::env::set_var(&k, val),
                None => std::env::remove_var(&k),
            }
        }
    }

    #[test]
    fn network_from_env_defaults_to_signet() {
        with_env(&[("LFM_NETWORK", None)], || {
            assert_eq!(network_from_env(), Network::Signet);
        });
    }

    #[test]
    fn network_from_env_parses_regtest() {
        with_env(&[("LFM_NETWORK", Some("regtest"))], || {
            assert_eq!(network_from_env(), Network::Regtest);
        });
    }

    #[test]
    fn network_from_env_unknown_value_falls_back_to_signet() {
        with_env(&[("LFM_NETWORK", Some("not-a-network"))], || {
            assert_eq!(network_from_env(), Network::Signet);
        });
    }

    #[test]
    fn lsp_from_env_requires_both_node_id_and_address() {
        with_env(&[
            ("LFM_LSP_NODE_ID", Some("02aa")),
            ("LFM_LSP_ADDRESS", None),
        ], || {
            assert!(lsp_from_env().is_none());
        });
        with_env(&[
            ("LFM_LSP_NODE_ID", None),
            ("LFM_LSP_ADDRESS", Some("127.0.0.1:19737")),
        ], || {
            assert!(lsp_from_env().is_none());
        });
    }

    #[test]
    fn lsp_from_env_parses_complete_config() {
        with_env(&[
            ("LFM_LSP_NODE_ID", Some("02ab")),
            ("LFM_LSP_ADDRESS", Some("127.0.0.1:19737")),
            ("LFM_LSP_TOKEN", Some("dev-token")),
        ], || {
            let lsp = lsp_from_env().expect("should parse");
            assert_eq!(lsp.node_id, "02ab");
            assert_eq!(lsp.address, "127.0.0.1:19737");
            assert_eq!(lsp.token, Some("dev-token".to_string()));
        });
    }

    #[test]
    fn bitcoind_rpc_from_env_parses_url() {
        with_env(&[("LFM_BITCOIND_RPC_URL", Some("http://alice:sekret@localhost:28443"))], || {
            let rpc = bitcoind_rpc_from_env().expect("should parse");
            assert_eq!(rpc.host, "localhost");
            assert_eq!(rpc.port, 28443);
            assert_eq!(rpc.user, "alice");
            assert_eq!(rpc.pass, "sekret");
        });
    }

    #[test]
    fn bitcoind_rpc_from_env_rejects_missing_scheme() {
        with_env(&[("LFM_BITCOIND_RPC_URL", Some("alice:sekret@localhost:28443"))], || {
            assert!(bitcoind_rpc_from_env().is_none());
        });
    }

    #[test]
    fn bitcoind_rpc_from_env_rejects_missing_creds() {
        with_env(&[("LFM_BITCOIND_RPC_URL", Some("http://localhost:28443"))], || {
            assert!(bitcoind_rpc_from_env().is_none());
        });
    }

    #[test]
    fn bitcoind_rpc_from_env_none_when_unset() {
        with_env(&[("LFM_BITCOIND_RPC_URL", None)], || {
            assert!(bitcoind_rpc_from_env().is_none());
        });
    }

    #[test]
    fn data_dir_signet_is_backward_compatible() {
        with_env(&[("LFM_NETWORK", None)], || {
            let dir = data_dir();
            // Default (signet) must stay at ~/.lightning-fm/ldk/ — no subdir.
            assert!(dir.ends_with("ldk"), "signet data_dir should be ldk/, got {:?}", dir);
        });
    }

    #[test]
    fn data_dir_regtest_uses_subpath() {
        with_env(&[("LFM_NETWORK", Some("regtest"))], || {
            let dir = data_dir();
            assert!(dir.ends_with("ldk/regtest"), "regtest data_dir should be ldk/regtest, got {:?}", dir);
        });
    }

    #[test]
    fn resolve_lsp_uses_env_when_config_lsp_is_none() {
        with_env(&[
            ("LFM_LSP_NODE_ID", Some("02dev")),
            ("LFM_LSP_ADDRESS", Some("127.0.0.1:19737")),
        ], || {
            let lsp = resolve_lsp_config(&NodeConfig::default());
            assert_eq!(lsp.node_id, "02dev");
            assert_eq!(lsp.address, "127.0.0.1:19737");
        });
    }

    #[test]
    fn resolve_lsp_explicit_config_beats_env() {
        with_env(&[
            ("LFM_LSP_NODE_ID", Some("02env")),
            ("LFM_LSP_ADDRESS", Some("10.0.0.1:9735")),
        ], || {
            let config = NodeConfig {
                lsp: Some(LspConfig {
                    node_id: "02explicit".to_string(),
                    address: "192.168.1.1:9735".to_string(),
                    token: None,
                }),
                ..Default::default()
            };
            let lsp = resolve_lsp_config(&config);
            assert_eq!(lsp.node_id, "02explicit");
        });
    }

    #[test]
    fn resolve_lsp_falls_back_to_mutinynet() {
        with_env(&[
            ("LFM_LSP_NODE_ID", None),
            ("LFM_LSP_ADDRESS", None),
        ], || {
            let lsp = resolve_lsp_config(&NodeConfig::default());
            assert_eq!(lsp.address, DEFAULT_LSP_ADDRESS);
            assert_eq!(lsp.node_id, DEFAULT_LSP_NODE_ID);
        });
    }

    #[tokio::test]
    async fn prepare_chain_source_regtest_requires_rpc_url() {
        with_env(&[
            ("LFM_NETWORK", Some("regtest")),
            ("LFM_BITCOIND_RPC_URL", None),
        ], || {});
        // Env set/unset are synchronous; now call the async helper.
        // Note: env is process-global; concurrent tokio tests that race this
        // are serialized via ENV_LOCK only for the set-phase. The call below
        // re-reads the env, so this is safe as long as no other test is
        // *concurrently* mutating the same vars.
        std::env::set_var("LFM_NETWORK", "regtest");
        std::env::remove_var("LFM_BITCOIND_RPC_URL");
        let result = prepare_chain_source().await;
        std::env::remove_var("LFM_NETWORK");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("LFM_BITCOIND_RPC_URL"));
    }
}
