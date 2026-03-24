// Lightning FM — Tauri commands
// Callable from the React frontend via invoke().

use tauri::State;
use crate::node::{LdkState, NodeInfo, NodeConfig, BalanceInfo, ChannelInfo};
use crate::identity::{IdentityState, IdentityInfo};
use crate::relay::{RelayState, TrackInfo, ProfileData};
use crate::credits::{CreditsState, CreditsInfo};
use crate::streaming::{StreamingState, StreamSession};
use nostr_sdk::prelude::*;
use std::path::Path;

// ─── LDK Node Commands ──────────────────────────────────────

#[tauri::command]
pub fn ldk_start(
    artist_mode: Option<bool>,
    listening_port: Option<u16>,
    state: State<LdkState>,
    app: tauri::AppHandle,
) -> Result<NodeInfo, String> {
    let mut node_lock = state.node.lock().map_err(|e| e.to_string())?;

    if node_lock.is_some() {
        return Err("Node is already running".to_string());
    }

    let config = NodeConfig {
        artist_mode: artist_mode.unwrap_or(false),
        listening_port,
        ..Default::default()
    };

    let node = crate::node::start_node(&config)?;
    let info = crate::node::get_node_info(&node, config.artist_mode);

    // Start the background event loop
    let shutdown_tx = crate::events::spawn_event_loop(node.clone(), app);
    if let Ok(mut shutdown_lock) = state.event_shutdown.lock() {
        *shutdown_lock = Some(shutdown_tx);
    }

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
        nip05: None, // managed separately
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
    let can_stream = crate::credits::can_stream(&credits_state);

    if can_stream {
        // Activate credits on first play
        crate::credits::activate_credits(&credits_state);

        let remaining = *credits_state.credits_remaining.lock().unwrap();

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
pub fn credits_info(state: State<CreditsState>) -> CreditsInfo {
    crate::credits::get_credits_info(&state)
}

/// Deduct credits (called by the streaming payment loop each interval)
#[tauri::command]
pub fn credits_deduct(amount: u64, state: State<CreditsState>) -> Result<CreditsInfo, String> {
    let success = crate::credits::deduct_credits(&state, amount);
    if !success {
        return Err("Insufficient credits".to_string());
    }
    Ok(crate::credits::get_credits_info(&state))
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

    // Deduct from credits (or wallet later)
    let success = crate::credits::deduct_credits(&credits_state, listener_cost);
    let credits_depleted = !success;

    if success {
        // Record the payment in the session
        session.record_payment();

        // Send keysend if artist has a Lightning node_id
        if let Some(ref node_id_hex) = session.lightning_node_id {
            let node_lock = ldk_state.node.lock().map_err(|e| e.to_string())?;
            if let Some(ref node) = *node_lock {
                let pubkey = crate::streaming::parse_lightning_pubkey(node_id_hex)?;
                let amount_msat = artist_sats * 1000;

                match node.spontaneous_payment().send(amount_msat, pubkey, None) {
                    Ok(payment_id) => {
                        log::info!(
                            "Keysend sent: {} sats ({} msat) to {}. Payment: {}. Track: {}",
                            artist_sats, amount_msat, node_id_hex, payment_id, session.track_id,
                        );
                    }
                    Err(e) => {
                        // Payment failed but credits already deducted.
                        // On Signet this is acceptable — log and continue.
                        // TODO (pre-mainnet): Implement optimistic deduction with rollback:
                        //   1. Deduct credits into PENDING state (not finalized)
                        //   2. On PaymentSuccessful event → finalize deduction
                        //   3. On PaymentFailed event → refund credits
                        //   4. On timeout (~120s, no event) → refund credits
                        //   Use payment_id as idempotency key. Event loop in events.rs
                        //   already emits payment_successful/payment_failed.
                        log::error!(
                            "Keysend failed: {} sats to {}. Error: {:?}. Track: {}",
                            artist_sats, node_id_hex, e, session.track_id,
                        );
                    }
                }
            } else {
                log::warn!("LDK node not running — skipping keysend for track {}", session.track_id);
            }
        } else {
            log::info!(
                "No lightning_node_id for artist — recording payment without keysend. Track: {}",
                session.track_id,
            );
        }

        log::info!(
            "Stream tick: {} sats to artist ({}), {} sats platform rake. Track: {}",
            artist_sats,
            if session.artist_direct { "direct" } else { "mirror" },
            platform_sats,
            session.track_id,
        );
    }

    let credits_remaining = *credits_state.credits_remaining.lock().unwrap();

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
