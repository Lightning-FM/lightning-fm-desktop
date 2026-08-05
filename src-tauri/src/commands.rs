// Lightning FM — Tauri commands
// Callable from the React frontend via invoke().

use tauri::{State, AppHandle, Manager, Emitter};
use crate::node::{LdkState, NodeInfo, NodeConfig, BalanceInfo, ChannelInfo};
use crate::identity::{IdentityState, IdentityInfo};
use crate::relay::{RelayState, TrackInfo, ProfileData};
use crate::credits::{CreditsState, CreditsInfo};
use crate::streaming::{StreamingState, StreamSession};
use nostr_sdk::prelude::*;
use std::path::Path;

// ─── LDK Node Commands ──────────────────────────────────────

#[tauri::command]
pub async fn ldk_start(
    artist_mode: Option<bool>,
    listening_port: Option<u16>,
    state: State<'_, LdkState>,
    app: tauri::AppHandle,
) -> Result<NodeInfo, String> {
    // Check if already running (before any blocking work)
    {
        let node_lock = state.node.lock().map_err(|e| e.to_string())?;
        if node_lock.is_some() {
            return Err("Node is already running".to_string());
        }
    }

    let config = NodeConfig {
        artist_mode: artist_mode.unwrap_or(false),
        listening_port,
        ..Default::default()
    };

    // Decide chain source (Esplora for signet, bitcoind RPC for regtest).
    // Async because the signet path runs Esplora health checks.
    let chain_source = crate::node::prepare_chain_source().await?;

    // Run the blocking LDK build+start on a dedicated thread
    let node = tokio::task::spawn_blocking(move || {
        crate::node::start_node(&config, &chain_source)
    })
    .await
    .map_err(|e| format!("Node start task panicked: {}", e))??;

    let am = artist_mode.unwrap_or(false);
    let info = crate::node::get_node_info(&node, am);

    // Start the background event loop
    let shutdown_tx = crate::events::spawn_event_loop(node.clone(), app);
    if let Ok(mut shutdown_lock) = state.event_shutdown.lock() {
        *shutdown_lock = Some(shutdown_tx);
    }

    let mut node_lock = state.node.lock().map_err(|e| e.to_string())?;
    *node_lock = Some(node);
    Ok(info)
}

#[tauri::command]
pub fn ldk_stop(state: State<LdkState>) -> Result<String, String> {
    // Signal event loop to stop before stopping the node
    if let Ok(mut shutdown_lock) = state.event_shutdown.lock() {
        if let Some(tx) = shutdown_lock.take() {
            let _ = tx.send(true);
        }
    }

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
        Some(node) => {
            // Derive artist_mode from whether the node has listening addresses
            let has_listeners = node.listening_addresses()
                .map(|a| !a.is_empty())
                .unwrap_or(false);
            Ok(crate::node::get_node_info(node, has_listeners))
        }
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

/// Returns the BIP39 mnemonic backup phrase from the Keychain.
/// SENSITIVE — the frontend should only display this behind a confirmation gate.
#[tauri::command]
pub fn ldk_get_mnemonic() -> Result<Vec<String>, String> {
    let mnemonic = crate::node::load_mnemonic_from_keychain()?;
    match mnemonic {
        Some(m) => Ok(m.words().map(|w| w.to_string()).collect()),
        None => Err("No mnemonic found — this node may be using a legacy seed without backup".to_string()),
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

/// The relay client bakes its signer in at connect time, so every identity
/// change MUST rebuild (or drop) it — a stale client silently signs and
/// publishes as the previous identity.
async fn rebuild_relay_client(
    keys: &Keys,
    relay_state: &State<'_, RelayState>,
) -> Result<(), String> {
    let client = crate::relay::connect(Some(keys)).await?;
    *relay_state.client.lock().await = Some(client);
    Ok(())
}

#[tauri::command]
pub async fn identity_create(
    display_name: Option<String>,
    state: State<'_, IdentityState>,
    relay_state: State<'_, RelayState>,
) -> Result<IdentityInfo, String> {
    let (keys, info) = {
        let mut keys_lock = state.keys.lock().map_err(|e| e.to_string())?;
        if keys_lock.is_some() {
            return Err("Identity already exists. Delete first to create a new one.".to_string());
        }
        let (keys, info) = crate::identity::create_identity_with_name(display_name)?;
        *keys_lock = Some(keys.clone());
        (keys, info)
    };
    rebuild_relay_client(&keys, &relay_state).await?;
    Ok(info)
}

#[tauri::command]
pub async fn identity_import(
    nsec: String,
    state: State<'_, IdentityState>,
    relay_state: State<'_, RelayState>,
) -> Result<IdentityInfo, String> {
    let (keys, info) = {
        let mut keys_lock = state.keys.lock().map_err(|e| e.to_string())?;
        let (keys, info) = crate::identity::import_nsec(&nsec)?;
        *keys_lock = Some(keys.clone());
        (keys, info)
    };
    rebuild_relay_client(&keys, &relay_state).await?;
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
pub async fn identity_delete(
    state: State<'_, IdentityState>,
    relay_state: State<'_, RelayState>,
) -> Result<String, String> {
    {
        let mut keys_lock = state.keys.lock().map_err(|e| e.to_string())?;
        crate::identity::delete_identity()?;
        *keys_lock = None;
    }
    // Drop the signed client — load_catalog reconnects anonymously
    *relay_state.client.lock().await = None;
    Ok("Identity deleted".to_string())
}

// ─── Relay & Browse Commands ────────────────────────────────

/// Connect to Nostr relays. Uses identity keys if available, otherwise
/// connects in read-only mode (anonymous browsing, no signing).
#[tauri::command]
pub async fn relay_connect(
    identity_state: State<'_, IdentityState>,
    relay_state: State<'_, RelayState>,
) -> Result<String, String> {
    let keys = identity_state.keys.lock()
        .ok()
        .and_then(|guard| guard.clone());

    let client = crate::relay::connect(keys.as_ref()).await?;
    let mut client_lock = relay_state.client.lock().await;
    *client_lock = Some(client);

    match keys {
        Some(_) => Ok("Connected to relays (authenticated)".to_string()),
        None => Ok("Connected to relays (anonymous)".to_string()),
    }
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

/// Load entire catalog: connect to relays, fetch tracks + profiles in batched requests.
/// Returns tracks with artist names already resolved. Single call from frontend.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogItem {
    pub event_id: String,
    pub artist_pubkey: String,
    pub artist_npub: String,
    pub artist_name: Option<String>,
    pub artist_picture: Option<String>,
    pub title: String,
    pub slug: String,
    pub duration_secs: Option<u64>,
    pub audio_hash: Option<String>,
    pub audio_url: Option<String>,
    pub fallback_url: Option<String>,
    pub mime_type: Option<String>,
    pub file_size: Option<u64>,
    pub preview_secs: Option<u64>,
    pub lightning_node_id: Option<String>,
    pub image_url: Option<String>,
    pub created_at: u64,
}

#[tauri::command]
pub async fn load_catalog(
    identity_state: State<'_, IdentityState>,
    relay_state: State<'_, RelayState>,
) -> Result<Vec<CatalogItem>, String> {
    // Connect to relays if not already connected
    {
        let client_lock = relay_state.client.lock().await;
        if client_lock.is_none() {
            drop(client_lock);
            // Connect anonymously or with identity if available
            let keys = identity_state.keys.lock()
                .ok()
                .and_then(|guard| guard.clone());
            let client = crate::relay::connect(keys.as_ref()).await?;
            let mut client_lock = relay_state.client.lock().await;
            *client_lock = Some(client);
        }
    }

    let client_lock = relay_state.client.lock().await;
    let client = client_lock.as_ref()
        .ok_or("Failed to connect to relays")?;

    // Fetch tracks + profiles in two batched relay requests
    let (tracks, profiles) = crate::relay::fetch_catalog(client).await?;

    // Merge profiles into tracks
    let items: Vec<CatalogItem> = tracks.into_iter().map(|t| {
        let profile = profiles.get(&t.artist_pubkey);
        CatalogItem {
            artist_name: profile.and_then(|p| p.display_name.clone().or(p.name.clone())),
            artist_picture: profile.and_then(|p| p.picture.clone()),
            event_id: t.event_id,
            artist_pubkey: t.artist_pubkey,
            artist_npub: t.artist_npub,
            title: t.title,
            slug: t.slug,
            duration_secs: t.duration_secs,
            audio_hash: t.audio_hash,
            audio_url: t.audio_url,
            fallback_url: t.fallback_url,
            mime_type: t.mime_type,
            file_size: t.file_size,
            preview_secs: t.preview_secs,
            lightning_node_id: t.lightning_node_id,
            image_url: t.image_url,
            created_at: t.created_at,
        }
    }).collect();

    log::info!("Catalog loaded: {} items", items.len());
    Ok(items)
}

// ─── Profile Commands ───────────────────────────────────────

/// Fetch the user's Nostr profile (kind 0) from relays.
/// Returns None for new identities that haven't published a profile yet.
#[tauri::command]
pub async fn profile_fetch(
    relay_state: State<'_, RelayState>,
) -> Result<Option<ProfileData>, String> {
    let client_lock = relay_state.client.lock().await;
    let client = client_lock.as_ref()
        .ok_or("Not connected to relays. Call relay_connect first.")?;

    crate::relay::fetch_profile(client).await
}

/// Set the user's Nostr profile (kind 0) and publish relay list (kind 10002).
/// Fetches existing profile first to preserve fields from other clients.
/// display_name is required; name defaults to lowercase display_name if not provided.
#[tauri::command]
pub async fn profile_set(
    display_name: String,
    name: Option<String>,
    about: Option<String>,
    picture: Option<String>,
    lud16: Option<String>,
    nip05: Option<String>,
    relay_state: State<'_, RelayState>,
) -> Result<ProfileData, String> {
    let client_lock = relay_state.client.lock().await;
    let client = client_lock.as_ref()
        .ok_or("Not connected to relays. Call relay_connect first.")?;

    let profile = ProfileData {
        name: Some(name.unwrap_or_else(|| display_name.to_lowercase())),
        display_name: Some(display_name),
        about,
        picture,
        lud16,
        nip05,
    };

    // Publish kind 0 (merges with existing) and kind 10002 (relay list)
    crate::relay::publish_profile(client, &profile).await?;
    crate::relay::publish_relay_list(client).await?;

    Ok(profile)
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
    ldk_state: State<'_, LdkState>,
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

    // Embedded cover art rides along to Blossom so the event can reference a
    // real URL. A missing or unreadable picture is not fatal — the track
    // publishes without artwork rather than failing the upload.
    let image_url = match crate::metadata::extract_artwork_raw(path) {
        Ok(Some((bytes, mime))) => {
            match crate::upload::upload_bytes_to_blossom(bytes, mime, &keys).await {
                Ok(art) => Some(art.url),
                Err(e) => {
                    log::warn!("Artwork upload failed, publishing without it: {}", e);
                    None
                }
            }
        }
        Ok(None) => None,
        Err(e) => {
            log::warn!("Could not read artwork from {}: {}", file_path, e);
            None
        }
    };

    // Publish kind 31337 to relays
    let client_lock = relay_state.client.lock().await;
    let client = client_lock.as_ref()
        .ok_or("Not connected to relays")?;

    // Get the artist's Lightning node_id if the LDK node is running
    let lightning_node_id = {
        let node_lock = ldk_state.node.lock().map_err(|e| e.to_string())?;
        node_lock.as_ref().map(|node| node.node_id().to_string())
    };

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
        lightning_node_id.as_deref(),
        image_url.as_deref(),
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
        lightning_node_id,
        image_url,
        created_at: nostr_sdk::Timestamp::now().as_u64(),
    })
}

// ─── Playback Commands ──────────────────────────────────────

/// Fetch audio for playback. Checks local cache first, then tries URLs in order.
/// Returns the local file path for the <audio> element and whether it was artist-direct.
#[derive(serde::Serialize)]
pub struct PlaybackResult {
    pub cache_path: String,
    pub artist_direct: bool,
}

#[tauri::command]
pub async fn playback_fetch(
    hash: String,
    urls: Vec<String>,
) -> Result<PlaybackResult, String> {
    let (path, artist_direct) = crate::playback::fetch_and_cache(&hash, urls).await?;
    Ok(PlaybackResult { cache_path: path, artist_direct })
}

/// Load a local file for dev testing — hashes it, caches it, returns path + hash.
#[derive(serde::Serialize)]
pub struct LocalLoadResult {
    pub hash: String,
    pub cache_path: String,
}

#[tauri::command]
pub fn playback_load_local(file_path: String) -> Result<LocalLoadResult, String> {
    let (hash, path) = crate::playback::load_local_file(&file_path)?;
    Ok(LocalLoadResult { hash, cache_path: path })
}

/// Resolve the test-data directory path. In production builds, looks in the
/// bundled resources. In dev mode, falls back to the project-relative path.
#[tauri::command]
pub fn get_test_data_dir(app: AppHandle) -> Result<String, String> {
    // Production: bundled resources inside the .app
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("test-data");
        if bundled.exists() {
            return Ok(bundled.to_string_lossy().to_string());
        }
    }

    // Dev: project-relative (src-tauri/../test-data)
    let dev_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("test-data"))
        .unwrap_or_default();
    if dev_path.exists() {
        return Ok(dev_path.to_string_lossy().to_string());
    }

    Err("Test data directory not found".to_string())
}

/// Batch-load an entire catalog of local files in one call.
/// For each file: hashes it, caches it, reads metadata, extracts artwork.
/// Replaces 3N sequential IPC calls with a single batch operation.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    pub artist: String,
    pub file_path: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogTrack {
    pub hash: String,
    pub cache_path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration_secs: f64,
    pub format: String,
    pub artwork_data_url: Option<String>,
}

#[tauri::command]
pub fn catalog_load_batch(entries: Vec<CatalogEntry>) -> Vec<CatalogTrack> {
    // Process all tracks in parallel — each file's hash/metadata/artwork is independent
    let handles: Vec<_> = entries.into_iter().map(|entry| {
        std::thread::spawn(move || {
            let path = Path::new(&entry.file_path);
            if !path.exists() {
                log::warn!("Catalog: file not found: {}", entry.file_path);
                return None;
            }

            let (hash, cache_path) = crate::playback::load_local_file(&entry.file_path).ok()?;

            let meta = crate::metadata::read_metadata(path).ok();
            let artwork = crate::metadata::extract_artwork(path)
                .ok()
                .flatten()
                .map(|a| a.data_url);

            Some(CatalogTrack {
                hash,
                cache_path,
                title: meta.as_ref().and_then(|m| m.title.clone()).or_else(|| Some(entry.artist.clone())),
                artist: meta.as_ref().and_then(|m| m.artist.clone()).or_else(|| Some(entry.artist.clone())),
                album: meta.as_ref().and_then(|m| m.album.clone()),
                duration_secs: meta.as_ref().map(|m| m.duration_secs).unwrap_or(0.0),
                format: meta.as_ref().map(|m| m.format.clone()).unwrap_or_else(|| "MP3".to_string()),
                artwork_data_url: artwork,
            })
        })
    }).collect();

    handles.into_iter()
        .filter_map(|h| h.join().ok().flatten())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── CatalogEntry deserialization (camelCase from frontend) ──

    #[test]
    fn catalog_entry_deserializes_camel_case() {
        let json = r#"{"artist": "Keypair", "filePath": "/tmp/test.mp3"}"#;
        let entry: CatalogEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.artist, "Keypair");
        assert_eq!(entry.file_path, "/tmp/test.mp3");
    }

    #[test]
    fn catalog_entry_rejects_snake_case() {
        let json = r#"{"artist": "Keypair", "file_path": "/tmp/test.mp3"}"#;
        let result: Result<CatalogEntry, _> = serde_json::from_str(json);
        assert!(result.is_err(), "snake_case file_path should be rejected — frontend sends camelCase");
    }

    // ─── CatalogTrack serialization (camelCase to frontend) ─────

    #[test]
    fn catalog_track_serializes_camel_case() {
        let track = CatalogTrack {
            hash: "abc123".to_string(),
            cache_path: "/tmp/cache/abc123".to_string(),
            title: Some("dev_null".to_string()),
            artist: Some("Keypair".to_string()),
            album: None,
            duration_secs: 169.0,
            format: "MP3".to_string(),
            artwork_data_url: Some("data:image/jpeg;base64,/9j/".to_string()),
        };
        let json = serde_json::to_string(&track).unwrap();

        // Must be camelCase for the frontend
        assert!(json.contains("cachePath"), "should serialize as cachePath, got: {}", json);
        assert!(json.contains("durationSecs"), "should serialize as durationSecs, got: {}", json);
        assert!(json.contains("artworkDataUrl"), "should serialize as artworkDataUrl, got: {}", json);

        // Must NOT contain snake_case
        assert!(!json.contains("cache_path"), "should not contain snake_case cache_path");
        assert!(!json.contains("duration_secs"), "should not contain snake_case duration_secs");
        assert!(!json.contains("artwork_data_url"), "should not contain snake_case artwork_data_url");
    }

    // ─── Batch loading ──────────────────────────────────────────

    #[test]
    fn catalog_load_batch_skips_missing_files() {
        let entries = vec![
            CatalogEntry { artist: "Test".to_string(), file_path: "/nonexistent/file.mp3".to_string() },
            CatalogEntry { artist: "Test2".to_string(), file_path: "/also/missing.mp3".to_string() },
        ];
        let result = catalog_load_batch(entries);
        assert!(result.is_empty(), "Missing files should be skipped, not error");
    }

    #[test]
    fn catalog_load_batch_empty_input() {
        let result = catalog_load_batch(vec![]);
        assert!(result.is_empty());
    }

    #[test]
    fn catalog_load_batch_loads_real_files() {
        let base = env!("CARGO_MANIFEST_DIR");
        let test_file = format!("{}/../test-data/keypair/dev_null.mp3", base);

        if !Path::new(&test_file).exists() {
            // Skip if test data not available (CI)
            return;
        }

        let entries = vec![
            CatalogEntry { artist: "Keypair".to_string(), file_path: test_file },
        ];
        let result = catalog_load_batch(entries);
        assert_eq!(result.len(), 1);

        let track = &result[0];
        assert!(!track.hash.is_empty());
        assert!(!track.cache_path.is_empty());
        assert!(track.duration_secs > 0.0, "Duration should be positive");
        assert_eq!(track.format, "MP3");
    }

    #[test]
    fn catalog_load_batch_parallel_produces_all_results() {
        let base = env!("CARGO_MANIFEST_DIR");
        let files = ["dev_null", "Display None", "finite dregs"];

        let entries: Vec<CatalogEntry> = files.iter().filter_map(|title| {
            let path = format!("{}/../test-data/keypair/{}.mp3", base, title);
            if Path::new(&path).exists() {
                Some(CatalogEntry { artist: "Keypair".to_string(), file_path: path })
            } else {
                None
            }
        }).collect();

        if entries.is_empty() {
            return; // Skip if test data not available
        }

        let expected_count = entries.len();
        let result = catalog_load_batch(entries);
        assert_eq!(result.len(), expected_count, "Parallel processing should return all tracks");

        // Verify all hashes are unique
        let hashes: std::collections::HashSet<&str> = result.iter().map(|t| t.hash.as_str()).collect();
        assert_eq!(hashes.len(), expected_count, "Each track should have a unique hash");
    }
}

/// Get cache stats (number of cached files, total size in bytes).
#[derive(serde::Serialize)]
pub struct CacheStats {
    pub count: usize,
    pub total_bytes: u64,
}

/// Read audio file as base64 data URL for browser playback
#[tauri::command]
pub fn playback_read_audio(file_path: String) -> Result<String, String> {
    crate::playback::read_audio_base64(&file_path)
}

#[tauri::command]
pub fn playback_cache_stats() -> CacheStats {
    let (count, total_bytes) = crate::playback::cache_stats();
    CacheStats { count, total_bytes }
}

/// Start playback — returns the audio path and playback mode.
/// If the user has credits/funding, they get full playback.
/// If unfunded, they get preview-only (frontend enforces the cutoff).
#[derive(serde::Serialize)]
pub struct PlaybackStartResult {
    pub cache_path: String,
    pub artist_direct: bool,
    pub mode: String,             // "full" or "preview"
    pub preview_secs: Option<u64>, // only set if mode == "preview"
    pub credits_remaining: u64,
}

#[tauri::command]
pub async fn playback_start(
    hash: String,
    urls: Vec<String>,
    preview_secs: Option<u64>,
    credits_state: State<'_, CreditsState>,
) -> Result<PlaybackStartResult, String> {
    // Fetch the audio (cache → P2P → mirror)
    let (path, artist_direct) = crate::playback::fetch_and_cache(&hash, urls).await?;

    // Determine playback mode based on funding
    let can_stream = crate::credits::can_stream(&credits_state)?;

    if can_stream {
        // Activate credits on first play
        crate::credits::activate_credits(&credits_state)?;

        let remaining = *credits_state.credits_remaining.lock()
            .map_err(|e| format!("Failed to lock credits_remaining: {e}"))?;

        Ok(PlaybackStartResult {
            cache_path: path,
            artist_direct,
            mode: "full".to_string(),
            preview_secs: None,
            credits_remaining: remaining,
        })
    } else {
        Ok(PlaybackStartResult {
            cache_path: path,
            artist_direct,
            mode: "preview".to_string(),
            preview_secs: Some(preview_secs.unwrap_or(10)),
            credits_remaining: 0,
        })
    }
}

// ─── Credits Commands ───────────────────────────────────────

/// Get current credits info
#[tauri::command]
pub fn credits_info(state: State<CreditsState>) -> Result<CreditsInfo, String> {
    crate::credits::get_credits_info(&state)
}

/// Deduct credits (called by the streaming payment loop each interval)
#[tauri::command]
pub fn credits_deduct(amount: u64, state: State<CreditsState>) -> Result<CreditsInfo, String> {
    let success = crate::credits::deduct_credits(&state, amount)?;
    if !success {
        return Err("Insufficient credits".to_string());
    }
    crate::credits::get_credits_info(&state)
}

// ─── Streaming Payment Commands ─────────────────────────────

/// Start a streaming session for a track
#[tauri::command]
pub fn stream_start(
    track_id: String,
    artist_pubkey: String,
    lightning_node_id: Option<String>,
    artist_direct: bool,
    state: State<StreamingState>,
) -> Result<StreamSession, String> {
    // Validate lightning_node_id if provided
    if let Some(ref node_id) = lightning_node_id {
        crate::streaming::parse_lightning_pubkey(node_id)?;
    }

    let mut session_lock = state.session.lock().map_err(|e| e.to_string())?;
    let session = StreamSession::new(
        &track_id,
        &artist_pubkey,
        lightning_node_id.as_deref(),
        artist_direct,
    );
    *session_lock = Some(session.clone());
    Ok(session)
}

/// Process a payment interval — deducts credits and records the payment.
/// Returns the updated session and payment details.
/// The frontend calls this every 60 seconds while audio is playing.
#[derive(serde::Serialize)]
pub struct IntervalResult {
    pub session: StreamSession,
    pub artist_sats: u64,
    pub platform_sats: u64,
    pub listener_sats: u64,
    pub credits_remaining: u64,
    pub credits_depleted: bool,
}

#[tauri::command]
pub fn stream_tick(
    streaming_state: State<StreamingState>,
    credits_state: State<CreditsState>,
    ldk_state: State<LdkState>,
) -> Result<IntervalResult, String> {
    let mut session_lock = streaming_state.session.lock().map_err(|e| e.to_string())?;
    let session = session_lock.as_mut()
        .ok_or("No active streaming session")?;

    if !session.is_playing {
        return Err("Session is paused".to_string());
    }

    // Calculate the split
    let (artist_sats, platform_sats) = crate::streaming::calculate_split(session.artist_direct);
    let listener_cost = crate::streaming::listener_cost_per_interval();

    // Resolve everything fallible BEFORE deducting, so no `?` can return
    // after credits leave the pool without a refund. Clone the node Arc out
    // of the mutex so the lock isn't held across the keysend call below.
    let keysend_target = match session.lightning_node_id {
        Some(ref node_id_hex) => {
            let pubkey = crate::streaming::parse_lightning_pubkey(node_id_hex)?;
            let node = {
                let node_lock = ldk_state.node.lock().map_err(|e| e.to_string())?;
                (*node_lock).clone()
            };
            Some((node_id_hex.clone(), pubkey, node))
        }
        None => None,
    };

    // Deduct from credits (or wallet later)
    let success = crate::credits::deduct_credits(&credits_state, listener_cost)?;
    let credits_depleted = !success;

    if success {
        // Record the payment in the session
        session.record_payment();

        // Send keysend with custom TLV metadata if artist has a Lightning node_id
        match keysend_target {
            Some((node_id_hex, pubkey, Some(node))) => {
                let amount_msat = artist_sats * 1000;
                let custom_tlvs = crate::streaming::build_custom_tlv_vec(
                    &session.track_id,
                    &session.artist_pubkey,
                );

                match node.spontaneous_payment().send_with_custom_tlvs(amount_msat, pubkey, None, custom_tlvs) {
                    Ok(payment_id) => {
                        log::info!(
                            "Keysend sent: {} sats ({} msat) to {} with TLV metadata. Payment: {}. Track: {}",
                            artist_sats, amount_msat, node_id_hex, payment_id, session.track_id,
                        );
                    }
                    Err(e) => {
                        // Keysend failed immediately — refund the optimistically deducted credits
                        if let Err(refund_err) = crate::credits::refund_credits(&credits_state, listener_cost) {
                            log::error!(
                                "CRITICAL: Failed to refund {} sats after keysend failure: {}. Track: {}",
                                listener_cost, refund_err, session.track_id,
                            );
                        } else {
                            log::warn!(
                                "Keysend failed, {} sats refunded to credits. Error: {:?}. Track: {}",
                                listener_cost, e, session.track_id,
                            );
                        }
                    }
                }
            }
            Some((_, _, None)) => {
                // LDK node not running — refund credits since no payment was sent
                if let Err(refund_err) = crate::credits::refund_credits(&credits_state, listener_cost) {
                    log::error!(
                        "CRITICAL: LDK node not running and failed to refund {} sats: {}. Track: {}",
                        listener_cost, refund_err, session.track_id,
                    );
                } else {
                    log::warn!(
                        "LDK node not running — {} sats refunded. Track: {}",
                        listener_cost, session.track_id,
                    );
                }
            }
            None => {
                log::info!(
                    "No lightning_node_id for artist — recording payment without keysend. Track: {}",
                    session.track_id,
                );
            }
        }

        log::info!(
            "Stream tick: {} sats to artist ({}), {} sats platform rake. Track: {}",
            artist_sats,
            if session.artist_direct { "direct" } else { "mirror" },
            platform_sats,
            session.track_id,
        );
    }

    let credits_remaining = *credits_state.credits_remaining.lock()
        .map_err(|e| format!("Failed to lock credits_remaining: {e}"))?;

    Ok(IntervalResult {
        session: session.clone(),
        artist_sats,
        platform_sats,
        listener_sats: listener_cost,
        credits_remaining,
        credits_depleted,
    })
}

/// Pause the active streaming session
#[tauri::command]
pub fn stream_pause(state: State<StreamingState>) -> Result<StreamSession, String> {
    let mut session_lock = state.session.lock().map_err(|e| e.to_string())?;
    let session = session_lock.as_mut()
        .ok_or("No active streaming session")?;
    session.pause();
    Ok(session.clone())
}

/// Resume the active streaming session
#[tauri::command]
pub fn stream_resume(state: State<StreamingState>) -> Result<StreamSession, String> {
    let mut session_lock = state.session.lock().map_err(|e| e.to_string())?;
    let session = session_lock.as_mut()
        .ok_or("No active streaming session")?;
    session.resume();
    Ok(session.clone())
}

/// Stop the active streaming session and return final stats
#[tauri::command]
pub fn stream_stop(state: State<StreamingState>) -> Result<StreamSession, String> {
    let mut session_lock = state.session.lock().map_err(|e| e.to_string())?;
    session_lock.take()
        .ok_or("No active streaming session".to_string())
}

/// Get current streaming session info
#[tauri::command]
pub fn stream_info(state: State<StreamingState>) -> Result<Option<StreamSession>, String> {
    let session_lock = state.session.lock().map_err(|e| e.to_string())?;
    Ok(session_lock.clone())
}

// ─── Metadata & Waveform Commands ──────────────────────────

/// Read metadata from an audio file's embedded tags (ID3, Vorbis, etc.)
/// Returns title, artist, album, genre, year, lyrics, audio properties.
#[tauri::command]
pub fn metadata_read(file_path: String) -> Result<crate::metadata::AudioMetadata, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }
    crate::metadata::read_metadata(path)
}

/// Audio extensions the upload flow accepts.
const AUDIO_EXTENSIONS: &[&str] = &[
    "wav", "flac", "aiff", "aif", "mp3", "ogg", "m4a", "aac", "opus",
];

fn is_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Expand a selection of files and/or directories into a flat list of audio
/// file paths. Directories are walked one level deep (an album folder);
/// non-audio files are dropped. Order is stable so track numbering is
/// predictable.
#[tauri::command]
pub fn expand_audio_paths(paths: Vec<String>) -> Result<Vec<String>, String> {
    let mut files: Vec<String> = Vec::new();

    for raw in paths {
        let path = Path::new(&raw);
        if path.is_dir() {
            let entries = std::fs::read_dir(path)
                .map_err(|e| format!("Could not read folder {}: {}", raw, e))?;
            let mut in_dir: Vec<String> = entries
                .filter_map(|entry| entry.ok())
                .map(|entry| entry.path())
                .filter(|p| p.is_file() && is_audio_file(p))
                .filter_map(|p| p.to_str().map(|s| s.to_string()))
                .collect();
            in_dir.sort();
            files.extend(in_dir);
        } else if path.is_file() && is_audio_file(path) {
            files.push(raw);
        }
    }

    Ok(files)
}

/// Write metadata back to an audio file's tags.
/// Called at publish time so the file on disk has correct tags before
/// hashing and uploading to Blossom. Only writes fields that are provided.
#[tauri::command]
pub fn metadata_write(
    file_path: String,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    track_number: Option<u32>,
    genre: Option<String>,
    year: Option<String>,
    lyrics: Option<String>,
) -> Result<(), String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let write_data = crate::metadata::MetadataWrite {
        title,
        artist,
        album,
        track_number,
        genre,
        year,
        lyrics,
    };
    crate::metadata::write_metadata(path, &write_data)
}

/// Extract embedded artwork from an audio file as a base64 data URL.
/// Returns None if no artwork is embedded.
#[tauri::command]
pub fn artwork_extract(file_path: String) -> Result<Option<crate::metadata::ExtractedArtwork>, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }
    crate::metadata::extract_artwork(path)
}

/// Generate waveform peaks from an audio file.
/// Decodes to PCM, computes peaks, caches to ~/.lightning-fm/waveforms/.
/// Returns 200 normalized floats (0.0-1.0) for rendering.
#[tauri::command]
pub fn waveform_generate(
    file_path: String,
    peak_count: Option<usize>,
) -> Result<crate::waveform::WaveformData, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }
    crate::waveform::generate_peaks(path, peak_count)
}

// ─── Withdrawal Commands ───────────────────────────────────

/// Pay a BOLT 11 Lightning invoice (artist withdrawal via invoice)
#[derive(serde::Serialize)]
pub struct PaymentResult {
    pub payment_id: String,
    pub amount_msat: Option<u64>,
}

#[tauri::command]
pub fn withdraw_lightning(
    invoice: String,
    state: State<LdkState>,
) -> Result<PaymentResult, String> {
    let node_lock = state.node.lock().map_err(|e| e.to_string())?;
    let node = node_lock.as_ref().ok_or("Node is not running")?;

    let bolt11 = invoice.parse::<ldk_node::lightning_invoice::Bolt11Invoice>()
        .map_err(|e| format!("Invalid BOLT 11 invoice: {}", e))?;

    let amount_msat = bolt11.amount_milli_satoshis();

    let payment_id = node.bolt11_payment().send(&bolt11, None)
        .map_err(|e| format!("Payment failed: {:?}", e))?;

    log::info!("Withdrawal payment sent: {} ({})", payment_id, invoice.get(..20).unwrap_or(&invoice));

    Ok(PaymentResult {
        payment_id: format!("{}", payment_id),
        amount_msat,
    })
}

/// Send on-chain Bitcoin withdrawal to an address
#[derive(serde::Serialize)]
pub struct OnchainResult {
    pub txid: String,
}

#[tauri::command]
pub fn withdraw_onchain(
    address: String,
    amount_sats: Option<u64>,
    state: State<LdkState>,
) -> Result<OnchainResult, String> {
    let node_lock = state.node.lock().map_err(|e| e.to_string())?;
    let node = node_lock.as_ref().ok_or("Node is not running")?;

    let addr: ldk_node::bitcoin::Address<ldk_node::bitcoin::address::NetworkUnchecked> = address.parse()
        .map_err(|e| format!("Invalid Bitcoin address: {:?}", e))?;
    let addr = addr.require_network(ldk_node::bitcoin::Network::Signet)
        .map_err(|e| format!("Address is not valid for signet: {:?}", e))?;

    let txid = if let Some(sats) = amount_sats {
        node.onchain_payment().send_to_address(&addr, sats, None)
            .map_err(|e| format!("On-chain send failed: {:?}", e))?
    } else {
        // Send all funds (retain_reserves=false — sweep everything)
        node.onchain_payment().send_all_to_address(&addr, false, None)
            .map_err(|e| format!("On-chain send-all failed: {:?}", e))?
    };

    log::info!("On-chain withdrawal: {} sats to {} (txid: {})",
        amount_sats.map(|s| s.to_string()).unwrap_or_else(|| "all".to_string()),
        address, txid);

    Ok(OnchainResult {
        txid: format!("{}", txid),
    })
}

// ─── Invoice Commands ─────────────────────────────────────

/// Create a BOLT 11 invoice for receiving Lightning payments (artist mode)
#[derive(serde::Serialize)]
pub struct InvoiceResult {
    pub bolt11: String,
    pub amount_sats: u64,
    pub expiry_secs: u32,
}

#[tauri::command]
pub fn ldk_create_invoice(
    amount_sats: u64,
    description: String,
    state: State<LdkState>,
) -> Result<InvoiceResult, String> {
    let node_lock = state.node.lock().map_err(|e| e.to_string())?;
    let node = node_lock.as_ref().ok_or("Node is not running")?;

    let amount_msat = amount_sats * 1000;
    let expiry_secs: u32 = 3600; // 1 hour

    let desc = ldk_node::lightning_invoice::Description::new(description.clone())
        .map_err(|e| format!("Invalid invoice description: {:?}", e))?;
    let invoice_desc = ldk_node::lightning_invoice::Bolt11InvoiceDescription::Direct(desc);

    // Use receive_via_jit_channel so first-time listeners with no inbound liquidity
    // can still receive payments: the configured LSPS2 LSP opens a JIT channel on
    // invoice payment. Existing receivers with inbound capacity also work — the LSP
    // routing hint lets payers either route through existing channels or trigger
    // the JIT open, whichever the routing layer prefers.
    //
    // max_total_lsp_fee_limit_msat = None → accept the LSP's cheapest offer.
    let invoice = node.bolt11_payment()
        .receive_via_jit_channel(amount_msat, &invoice_desc, expiry_secs, None)
        .map_err(|e| format!("Failed to create JIT invoice: {:?}", e))?;

    let bolt11_str = invoice.to_string();
    log::info!(
        "Created BOLT 11 JIT invoice: {} sats, desc=\"{}\"",
        amount_sats, description,
    );

    Ok(InvoiceResult {
        bolt11: bolt11_str,
        amount_sats,
        expiry_secs,
    })
}

// ─── Channel Commands ────────────────────────────────────

/// Open a Lightning channel to a peer node
#[derive(serde::Serialize)]
pub struct ChannelOpenResult {
    pub channel_id: String,
}

#[tauri::command]
pub async fn ldk_open_channel(
    node_id: Option<String>,
    address: Option<String>,
    amount_sats: u64,
    state: State<'_, LdkState>,
) -> Result<ChannelOpenResult, String> {
    // When the frontend omits the peer, target the resolved LSP (LFM_LSP_* env
    // or the Mutinynet default) — same chain resolve_lsp_config uses at startup.
    let (node_id, address) = match (node_id, address) {
        (Some(n), Some(a)) => (n, a),
        _ => {
            let lsp = crate::node::resolve_lsp_config(&NodeConfig::default());
            (lsp.node_id, lsp.address)
        }
    };

    // Clone the Arc<Node> so we can move it into spawn_blocking
    let node = {
        let node_lock = state.node.lock().map_err(|e| e.to_string())?;
        node_lock.as_ref().ok_or("Node is not running")?.clone()
    };

    // Run blocking LDK operations on a blocking thread
    tokio::task::spawn_blocking(move || {
        let pubkey: ldk_node::bitcoin::secp256k1::PublicKey = node_id.parse()
            .map_err(|e| format!("Invalid node ID: {e}"))?;

        let addr: ldk_node::lightning::ln::msgs::SocketAddress = address.parse()
            .map_err(|e| format!("Invalid address: {e}"))?;

        // Connect to the peer first (ignore "already connected" errors)
        match node.connect(pubkey, addr.clone(), true) {
            Ok(_) => log::info!("Connected to peer: {}", node_id),
            Err(e) => {
                let err_str = format!("{e:?}");
                if err_str.contains("AlreadyConnected") {
                    log::info!("Already connected to peer: {}", node_id);
                } else {
                    return Err(format!("Failed to connect to peer: {e:?}"));
                }
            }
        }

        // Open the channel
        let user_channel_id = node.open_channel(pubkey, addr, amount_sats, None, None)
            .map_err(|e| format!("Failed to open channel: {e:?}"))?;

        log::info!("Channel opened: {} sats to {}. UserChannelId: {}", amount_sats, node_id, user_channel_id);

        Ok(ChannelOpenResult {
            channel_id: format!("{}", user_channel_id),
        })
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

/// Connect to a peer without opening a channel
#[tauri::command]
pub async fn ldk_connect_peer(
    node_id: String,
    address: String,
    state: State<'_, LdkState>,
) -> Result<String, String> {
    let node = {
        let node_lock = state.node.lock().map_err(|e| e.to_string())?;
        node_lock.as_ref().ok_or("Node is not running")?.clone()
    };

    let addr_str = address.clone();
    let nid = node_id.clone();
    tokio::task::spawn_blocking(move || {
        let pubkey: ldk_node::bitcoin::secp256k1::PublicKey = node_id.parse()
            .map_err(|e| format!("Invalid node ID: {e}"))?;

        let addr: ldk_node::lightning::ln::msgs::SocketAddress = address.parse()
            .map_err(|e| format!("Invalid address: {e}"))?;

        node.connect(pubkey, addr, true)
            .map_err(|e| format!("Failed to connect to peer: {e:?}"))?;

        log::info!("Connected to peer: {} @ {}", nid, addr_str);
        Ok(format!("Connected to {}", nid))
    })
    .await
    .map_err(|e| format!("Task failed: {e}"))?
}

// ─── Product Commands (downloads for sale) ───────────────────

/// Publish a product listing (kind 30402). Replaces any existing listing
/// with the same slug (addressable event semantics).
#[tauri::command]
pub async fn product_publish(
    draft: crate::products::ProductDraft,
    relay_state: State<'_, RelayState>,
) -> Result<String, String> {
    let client_lock = relay_state.client.lock().await;
    let client = client_lock.as_ref()
        .ok_or("Not connected to relays. Call relay_connect first.")?;
    crate::products::publish_product(client, &draft, "active").await
}

/// List the signed-in artist's own product listings.
#[tauri::command]
pub async fn product_list_mine(
    identity_state: State<'_, IdentityState>,
    relay_state: State<'_, RelayState>,
) -> Result<Vec<crate::products::ProductInfo>, String> {
    let keys = identity_state.keys.lock()
        .ok()
        .and_then(|guard| guard.clone())
        .ok_or("No identity. Create or import one first.")?;

    let client_lock = relay_state.client.lock().await;
    let client = client_lock.as_ref()
        .ok_or("Not connected to relays. Call relay_connect first.")?;
    crate::products::fetch_my_products(client, keys.public_key()).await
}

/// Upload the purchasable artifact for a product to the artist's seller
/// daemon (NIP-98 authenticated PUT). Call before product_publish so the
/// listing never points at a product the daemon can't deliver.
#[tauri::command]
pub async fn product_upload_artifact(
    file_path: String,
    slug: String,
    title: String,
    price_sats: u64,
    floor_sats: Option<u64>,
    format: String,
    endpoint: String,
    identity_state: State<'_, IdentityState>,
) -> Result<(), String> {
    let keys = identity_state.keys.lock()
        .ok()
        .and_then(|guard| guard.clone())
        .ok_or("No identity. Create or import one first.")?;

    crate::upload::upload_artifact_to_daemon(
        std::path::Path::new(&file_path),
        &keys,
        &endpoint,
        &slug,
        &title,
        price_sats,
        floor_sats,
        &format,
    ).await
}

/// Upload the purchasable artifact to the hosted gate (Option 3 free
/// tier) and register the product there — no artist node involved.
/// Returns the gate endpoint for the listing's `endpoint` tag.
#[tauri::command]
pub async fn product_upload_artifact_gate(
    file_path: String,
    slug: String,
    title: String,
    price_sats: u64,
    floor_sats: Option<u64>,
    format: String,
    identity_state: State<'_, IdentityState>,
) -> Result<String, String> {
    let keys = identity_state.keys.lock()
        .ok()
        .and_then(|guard| guard.clone())
        .ok_or("No identity. Create or import one first.")?;

    crate::upload::upload_artifact_to_gate(
        std::path::Path::new(&file_path),
        &keys,
        &slug,
        &title,
        price_sats,
        floor_sats,
        &format,
    ).await
}

/// Fetch active product listings for the catalog's artists (buyer browse).
#[tauri::command]
pub async fn products_fetch(
    authors: Vec<String>,
    relay_state: State<'_, RelayState>,
) -> Result<Vec<crate::products::ProductInfo>, String> {
    let pubkeys: Vec<nostr_sdk::PublicKey> = authors
        .iter()
        .filter_map(|a| a.parse().ok())
        .collect();

    let client_lock = relay_state.client.lock().await;
    let client = client_lock.as_ref()
        .ok_or("Not connected to relays. Call relay_connect first.")?;
    crate::products::fetch_products_for_authors(client, pubkeys).await
}

#[derive(serde::Deserialize)]
struct SellerInvoice {
    bolt11: String,
    payment_hash: String,
    amount_sats: u64,
    claim_token: Option<String>,
}

fn emit_purchase_progress(app: &AppHandle, stage: &str, detail: String) {
    let _ = app.emit("purchase-progress", serde_json::json!({
        "stage": stage,
        "detail": detail,
    }));
}

/// One-click purchase: invoice from the artist's daemon → pay from the
/// embedded node → preimage from the payment store → download the artifact.
/// Emits "purchase-progress" events; returns the recorded purchase.
#[tauri::command]
pub async fn purchase_execute(
    endpoint: String,
    slug: String,
    title: String,
    artist_pubkey: String,
    format: Option<String>,
    ldk_state: State<'_, LdkState>,
    purchases_state: State<'_, crate::purchases::PurchasesState>,
    identity_state: State<'_, IdentityState>,
    app: AppHandle,
) -> Result<crate::purchases::PurchaseRecord, String> {
    // Purchases are recorded against the signed-in identity so one signer's
    // history never surfaces for the next.
    let buyer_pubkey = identity_state.keys.lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|k| k.public_key().to_hex()))
        .ok_or("No identity. Create or import one first.")?;
    let base = endpoint.trim_end_matches('/').to_string();

    // 1. Invoice from the seller daemon
    emit_purchase_progress(&app, "request", format!("{} · requesting invoice", title));
    let http = reqwest::Client::new();
    let resp = http
        .post(format!("{}/products/{}/invoice", base, slug))
        .json(&serde_json::json!({}))
        .send()
        .await
        .map_err(|e| format!("Artist node unreachable: {e}"))?;
    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Invoice refused: {body}"));
    }
    let invoice: SellerInvoice = resp
        .json()
        .await
        .map_err(|e| format!("Bad invoice response: {e}"))?;
    emit_purchase_progress(
        &app,
        "invoice",
        format!("{} sats · paying from node balance", invoice.amount_sats),
    );

    // 2. Pay from the embedded node
    let node = {
        let node_lock = ldk_state.node.lock().map_err(|e| e.to_string())?;
        node_lock.as_ref().ok_or("Node is not running")?.clone()
    };
    let bolt11: ldk_node::lightning_invoice::Bolt11Invoice = invoice
        .bolt11
        .parse()
        .map_err(|e| format!("Invalid invoice from seller: {e:?}"))?;

    let pay_node = node.clone();
    let payment_id = tokio::task::spawn_blocking(move || {
        pay_node
            .bolt11_payment()
            .send(&bolt11, None)
            .map_err(|e| format!("Payment failed: {e}"))
    })
    .await
    .map_err(|e| format!("Payment task failed: {e}"))??;

    // 3. Wait for settlement; the preimage is our receipt
    let wait_node = node.clone();
    let preimage = tokio::task::spawn_blocking(move || {
        for _ in 0..240 {
            if let Some(details) = wait_node.payment(&payment_id) {
                match details.status {
                    ldk_node::payment::PaymentStatus::Succeeded => {
                        if let ldk_node::payment::PaymentKind::Bolt11 {
                            preimage: Some(p), ..
                        } = details.kind
                        {
                            return Ok(hex::encode(p.0));
                        }
                    }
                    ldk_node::payment::PaymentStatus::Failed => {
                        return Err("Payment failed — no route or seller offline".to_string());
                    }
                    _ => {}
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
        Err("Payment not settled after 2 minutes".to_string())
    })
    .await
    .map_err(|e| format!("Settlement task failed: {e}"))??;

    emit_purchase_progress(&app, "settled", "payment confirmed · downloading".to_string());

    // 4. Download the artifact with the preimage
    let dl = http
        .get(format!(
            "{}/products/{}/download?preimage={}",
            base, slug, preimage
        ))
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;
    if !dl.status().is_success() {
        return Err(format!("Download refused ({})", dl.status()));
    }
    let bytes = dl
        .bytes()
        .await
        .map_err(|e| format!("Download stream failed: {e}"))?;

    let dir = crate::purchases::purchases_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create purchases dir: {e}"))?;
    let ext = format.clone().unwrap_or_else(|| "bin".to_string());
    let file_path = dir.join(format!("{}.{}", slug, ext));
    std::fs::write(&file_path, &bytes).map_err(|e| format!("Failed to save artifact: {e}"))?;

    // 5. Record it
    let record = crate::purchases::PurchaseRecord {
        slug,
        title,
        artist_pubkey,
        buyer_pubkey,
        endpoint: base,
        amount_sats: invoice.amount_sats,
        payment_hash: invoice.payment_hash,
        preimage,
        claim_token: invoice.claim_token,
        format,
        file_path: file_path.to_string_lossy().to_string(),
        purchased_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    };
    crate::purchases::record_purchase(&purchases_state, record.clone())?;
    emit_purchase_progress(&app, "delivered", format!("{} bytes saved", bytes.len()));

    Ok(record)
}

/// List the signed-in identity's past purchases, newest first.
#[tauri::command]
pub fn purchases_list(
    purchases_state: State<'_, crate::purchases::PurchasesState>,
    identity_state: State<'_, IdentityState>,
) -> Result<Vec<crate::purchases::PurchaseRecord>, String> {
    let buyer_pubkey = identity_state.keys.lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|k| k.public_key().to_hex()))
        .unwrap_or_default(); // signed out → no purchases visible
    crate::purchases::list_purchases(&purchases_state, &buyer_pubkey)
}

/// Activate or deactivate a listing by slug — republishes the same product
/// with the new status (same d tag replaces the previous event).
#[tauri::command]
pub async fn product_set_status(
    slug: String,
    status: String,
    identity_state: State<'_, IdentityState>,
    relay_state: State<'_, RelayState>,
) -> Result<String, String> {
    if !matches!(status.as_str(), "active" | "inactive") {
        return Err(format!("Invalid status: {}", status));
    }

    let keys = identity_state.keys.lock()
        .ok()
        .and_then(|guard| guard.clone())
        .ok_or("No identity. Create or import one first.")?;

    let client_lock = relay_state.client.lock().await;
    let client = client_lock.as_ref()
        .ok_or("Not connected to relays. Call relay_connect first.")?;

    let products = crate::products::fetch_my_products(client, keys.public_key()).await?;
    let existing = products.into_iter()
        .find(|p| p.slug == slug)
        .ok_or_else(|| format!("No product with slug '{}'", slug))?;

    let draft = crate::products::ProductDraft {
        slug: existing.slug,
        title: existing.title,
        summary: existing.summary,
        description: existing.description,
        price_sats: existing.price_sats,
        floor_sats: existing.floor_sats,
        product_type: existing.product_type,
        format: existing.format,
        image_url: existing.image_url,
        track_refs: existing.track_refs,
        endpoint: existing.endpoint,
    };
    crate::products::publish_product(client, &draft, &status).await
}
