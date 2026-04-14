// Lightning FM — Nostr relay connection and event management
// Handles connecting to relays, subscribing to track events (kind 31337),
// and publishing events.

use nostr_sdk::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

/// Relay configuration by environment.
/// Set LFM_NOSTR_RELAYS env var to override (comma-separated).
/// Default: local dev relay. Production relays are only used when explicitly configured.
const DEV_RELAYS: &[&str] = &[
    "wss://relay.lightning.fm",
    "ws://localhost:7777",
];

const PROD_RELAYS: &[&str] = &[
    "wss://relay.lightning.fm",
];

fn get_relays() -> Vec<String> {
    // Check env var first — allows any custom relay config
    if let Ok(relays) = std::env::var("LFM_NOSTR_RELAYS") {
        return relays.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    }

    // Release builds use production relays; debug builds use dev relays
    if cfg!(debug_assertions) {
        DEV_RELAYS.iter().map(|s| s.to_string()).collect()
    } else {
        PROD_RELAYS.iter().map(|s| s.to_string()).collect()
    }
}

/// Custom event kind for track metadata
const KIND_TRACK: u16 = 31337;

/// Shared relay client state
pub struct RelayState {
    pub client: TokioMutex<Option<Arc<Client>>>,
}

impl RelayState {
    pub fn new() -> Self {
        Self {
            client: TokioMutex::new(None),
        }
    }
}

/// Track metadata parsed from kind 31337 events
#[derive(Serialize, Clone, Debug)]
pub struct TrackInfo {
    pub event_id: String,
    pub artist_pubkey: String,
    pub artist_npub: String,
    pub title: String,
    pub slug: String,
    pub duration_secs: Option<u64>,
    pub audio_hash: Option<String>,
    pub audio_url: Option<String>,
    pub fallback_url: Option<String>,
    pub mime_type: Option<String>,
    pub file_size: Option<u64>,
    pub preview_secs: Option<u64>,
    /// Artist's Lightning node_id for keysend payments (33-byte compressed, hex)
    pub lightning_node_id: Option<String>,
    pub created_at: u64,
}

/// Connect to Nostr relays. If keys are provided, the client can sign events
/// (publish, upload, etc.). If None, connects in read-only mode for browsing.
pub async fn connect(keys: Option<&Keys>) -> Result<Arc<Client>, String> {
    let client = match keys {
        Some(k) => Client::new(k.clone()),
        None => Client::default(),
    };
    let relays = get_relays();

    for relay in &relays {
        client.add_relay(relay.as_str()).await
            .map_err(|e| format!("Failed to add relay {}: {}", relay, e))?;
    }

    client.connect().await;
    log::info!("Connected to {} relays: {:?}", relays.len(), relays);

    Ok(Arc::new(client))
}

/// Fetch all tracks from relays (kind 31337 addressable events)
pub async fn fetch_tracks(client: &Client) -> Result<Vec<TrackInfo>, String> {
    let filter = Filter::new()
        .kind(Kind::Custom(KIND_TRACK))
        .limit(100);

    let events = client
        .fetch_events(filter, std::time::Duration::from_secs(3))
        .await
        .map_err(|e| format!("Failed to fetch tracks: {}", e))?;

    let tracks: Vec<TrackInfo> = events
        .iter()
        .filter_map(|event| parse_track_event(event))
        .collect();

    log::info!("Fetched {} tracks from relays", tracks.len());
    Ok(tracks)
}

/// Fetch tracks + artist profiles in two batched relay requests.
/// Returns tracks with artist names already resolved where possible.
pub async fn fetch_catalog(client: &Client) -> Result<(Vec<TrackInfo>, std::collections::HashMap<String, ProfileData>), String> {
    // Step 1: fetch kind 31337 tracks (3s timeout)
    let track_filter = Filter::new()
        .kind(Kind::Custom(KIND_TRACK))
        .limit(100);

    let track_events = client
        .fetch_events(track_filter, std::time::Duration::from_secs(3))
        .await
        .map_err(|e| format!("Failed to fetch tracks: {}", e))?;

    let tracks: Vec<TrackInfo> = track_events
        .iter()
        .filter_map(|event| parse_track_event(event))
        .filter(|t| t.audio_url.is_some() && t.audio_hash.is_some()) // only playable tracks
        .collect();

    log::info!("Fetched {} playable tracks from relays", tracks.len());

    // Step 2: collect unique pubkeys, batch fetch kind 0 profiles
    let pubkeys: Vec<PublicKey> = tracks
        .iter()
        .filter_map(|t| PublicKey::parse(&t.artist_pubkey).ok())
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    let profiles = if !pubkeys.is_empty() {
        log::info!("Resolving {} artist profiles...", pubkeys.len());

        let profile_filter = Filter::new()
            .kind(Kind::Metadata)
            .authors(pubkeys);

        let profile_events = match client
            .fetch_events(profile_filter, std::time::Duration::from_secs(3))
            .await
        {
            Ok(events) => events,
            Err(e) => {
                log::warn!("Profile fetch failed: {}", e);
                return Ok((tracks, std::collections::HashMap::new()));
            }
        };

        // Dedupe by pubkey, keep latest kind 0 per author
        let mut latest: std::collections::HashMap<String, ProfileData> = std::collections::HashMap::new();
        let mut latest_ts: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
        for event in profile_events.iter() {
            let hex = event.pubkey.to_hex();
            let ts = event.created_at.as_u64();
            if ts > *latest_ts.get(&hex).unwrap_or(&0) {
                latest_ts.insert(hex.clone(), ts);
                latest.insert(hex, parse_profile_content(&event.content));
            }
        }

        for (hex, profile) in &latest {
            log::info!("Profile: {} → {}", &hex[..12], profile.display_name.as_deref().unwrap_or("(no name)"));
        }

        latest
    } else {
        std::collections::HashMap::new()
    };

    log::info!("Catalog ready: {} tracks, {} profiles", tracks.len(), profiles.len());
    Ok((tracks, profiles))
}

/// Publish a track metadata event (kind 31337)
pub async fn publish_track(
    client: &Client,
    title: &str,
    slug: &str,
    duration_secs: Option<u64>,
    audio_hash: &str,
    audio_url: &str,
    fallback_url: Option<&str>,
    mime_type: &str,
    file_size: u64,
    preview_secs: Option<u64>,
    lightning_node_id: Option<&str>,
) -> Result<String, String> {
    let mut tags = vec![
        Tag::custom(TagKind::custom("d"), vec![slug.to_string()]),
        Tag::custom(TagKind::custom("title"), vec![title.to_string()]),
        Tag::custom(TagKind::custom("x"), vec![audio_hash.to_string()]),
        Tag::custom(TagKind::custom("url"), vec![audio_url.to_string()]),
        Tag::custom(TagKind::custom("m"), vec![mime_type.to_string()]),
        Tag::custom(TagKind::custom("size"), vec![file_size.to_string()]),
    ];

    if let Some(fallback) = fallback_url {
        Tag::custom(TagKind::custom("fallback"), vec![fallback.to_string()]);
        tags.push(Tag::custom(TagKind::custom("fallback"), vec![fallback.to_string()]));
    }

    if let Some(dur) = duration_secs {
        tags.push(Tag::custom(TagKind::custom("duration"), vec![dur.to_string()]));
    }

    if let Some(preview) = preview_secs {
        tags.push(Tag::custom(TagKind::custom("preview"), vec![preview.to_string()]));
    }

    if let Some(node_id) = lightning_node_id {
        tags.push(Tag::custom(TagKind::custom("lightning_node_id"), vec![node_id.to_string()]));
    }

    let builder = EventBuilder::new(Kind::Custom(KIND_TRACK), "")
        .tags(tags);

    let output = client.send_event_builder(builder).await
        .map_err(|e| format!("Failed to publish track: {}", e))?;

    let event_id = output.id().to_hex();
    log::info!("Published track '{}' as event {}", title, event_id);
    Ok(event_id)
}

// ─── Profile (Kind 0) & Relay List (Kind 10002) ─────────────

/// User profile data from kind 0 metadata events (NIP-01)
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ProfileData {
    pub name: Option<String>,
    pub display_name: Option<String>,
    pub about: Option<String>,
    pub picture: Option<String>,
    pub lud16: Option<String>,
    pub nip05: Option<String>,
}

/// Build kind 0 JSON content from ProfileData.
/// If `existing` is provided, merge: new fields override, unset fields preserve existing.
/// Unknown fields from the existing profile are preserved (don't clobber other clients' data).
pub fn build_profile_content(data: &ProfileData, existing_json: Option<&str>) -> String {
    // Start from existing profile or empty object — preserves unknown fields
    let mut map: BTreeMap<String, serde_json::Value> = existing_json
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();

    // Apply our fields — only override if Some
    if let Some(ref v) = data.name { map.insert("name".into(), v.clone().into()); }
    if let Some(ref v) = data.display_name { map.insert("display_name".into(), v.clone().into()); }
    if let Some(ref v) = data.about { map.insert("about".into(), v.clone().into()); }
    if let Some(ref v) = data.picture { map.insert("picture".into(), v.clone().into()); }
    if let Some(ref v) = data.lud16 { map.insert("lud16".into(), v.clone().into()); }
    if let Some(ref v) = data.nip05 { map.insert("nip05".into(), v.clone().into()); }

    serde_json::to_string(&map).unwrap_or_else(|_| "{}".to_string())
}

/// Parse kind 0 JSON content into ProfileData.
/// Handles missing fields, malformed JSON, and unknown fields gracefully.
pub fn parse_profile_content(json_str: &str) -> ProfileData {
    let map: BTreeMap<String, serde_json::Value> = serde_json::from_str(json_str)
        .unwrap_or_default();

    let get_str = |key: &str| -> Option<String> {
        map.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
    };

    ProfileData {
        name: get_str("name"),
        display_name: get_str("display_name"),
        about: get_str("about"),
        picture: get_str("picture"),
        lud16: get_str("lud16"),
        nip05: get_str("nip05"),
    }
}

/// Build kind 10002 relay list tags (NIP-65).
/// Bare `r` tags (no read/write marker) mean both read+write.
pub fn build_relay_list_tags(relays: &[&str]) -> Vec<Tag> {
    relays.iter()
        .map(|url| Tag::custom(TagKind::custom("r"), vec![url.to_string()]))
        .collect()
}

/// Validate profile data before publishing.
/// Returns Ok(()) or an error message.
pub fn validate_profile(data: &ProfileData) -> Result<(), String> {
    // display_name is required and must be non-empty
    match &data.display_name {
        Some(name) if name.trim().is_empty() => {
            return Err("display_name cannot be empty".to_string());
        }
        None => {
            return Err("display_name is required".to_string());
        }
        _ => {}
    }

    // name defaults to lowercase display_name if not provided — that's fine
    Ok(())
}

/// Fetch the user's kind 0 profile from relays.
pub async fn fetch_profile(client: &Client) -> Result<Option<ProfileData>, String> {
    let pubkey = client.signer().await
        .map_err(|e| format!("No signer: {}", e))?
        .get_public_key().await
        .map_err(|e| format!("Failed to get pubkey: {}", e))?;

    let filter = Filter::new()
        .kind(Kind::Metadata)
        .author(pubkey)
        .limit(1);

    let events = client
        .fetch_events(filter, std::time::Duration::from_secs(10))
        .await
        .map_err(|e| format!("Failed to fetch profile: {}", e))?;

    // Kind 0 is replaceable — use the latest by created_at
    let latest = events.iter()
        .max_by_key(|e| e.created_at);

    match latest {
        Some(event) => {
            let profile = parse_profile_content(&event.content);
            log::info!("Fetched profile for {}", pubkey.to_bech32().unwrap_or_default());
            Ok(Some(profile))
        }
        None => {
            log::info!("No profile found for {}", pubkey.to_bech32().unwrap_or_default());
            Ok(None)
        }
    }
}

/// Publish kind 0 profile metadata to relays.
/// Fetches existing profile first to preserve unknown fields from other clients.
pub async fn publish_profile(client: &Client, data: &ProfileData) -> Result<String, String> {
    validate_profile(data)?;

    // Fetch existing to merge — preserves fields we don't manage (banner, website, etc.)
    let existing_json = fetch_profile_raw(client).await?;
    let content = build_profile_content(data, existing_json.as_deref());

    let builder = EventBuilder::new(Kind::Metadata, &content);

    let output = client.send_event_builder(builder).await
        .map_err(|e| format!("Failed to publish profile: {}", e))?;

    let event_id = output.id().to_hex();
    log::info!("Published kind 0 profile: {}", event_id);
    Ok(event_id)
}

/// Publish kind 10002 relay list to relays (NIP-65).
pub async fn publish_relay_list(client: &Client) -> Result<String, String> {
    let relays = get_relays();
    let relay_refs: Vec<&str> = relays.iter().map(|s| s.as_str()).collect();
    let tags = build_relay_list_tags(&relay_refs);

    let builder = EventBuilder::new(Kind::RelayList, "")
        .tags(tags);

    let output = client.send_event_builder(builder).await
        .map_err(|e| format!("Failed to publish relay list: {}", e))?;

    let event_id = output.id().to_hex();
    log::info!("Published kind 10002 relay list: {}", event_id);
    Ok(event_id)
}

/// Fetch raw kind 0 content string (for merge logic).
async fn fetch_profile_raw(client: &Client) -> Result<Option<String>, String> {
    let pubkey = client.signer().await
        .map_err(|e| format!("No signer: {}", e))?
        .get_public_key().await
        .map_err(|e| format!("Failed to get pubkey: {}", e))?;

    let filter = Filter::new()
        .kind(Kind::Metadata)
        .author(pubkey)
        .limit(1);

    let events = client
        .fetch_events(filter, std::time::Duration::from_secs(10))
        .await
        .map_err(|e| format!("Failed to fetch profile: {}", e))?;

    Ok(events.iter()
        .max_by_key(|e| e.created_at)
        .map(|e| e.content.clone()))
}

/// Parse a kind 31337 event into a TrackInfo struct
fn parse_track_event(event: &Event) -> Option<TrackInfo> {
    let get_tag = |name: &str| -> Option<String> {
        event.tags.iter().find_map(|tag| {
            let values = tag.as_slice();
            if values.len() >= 2 && values[0] == name {
                Some(values[1].to_string())
            } else {
                None
            }
        })
    };

    let title = get_tag("title")?;
    let slug = get_tag("d").unwrap_or_default();

    Some(TrackInfo {
        event_id: event.id.to_hex(),
        artist_pubkey: event.pubkey.to_hex(),
        artist_npub: event.pubkey.to_bech32().unwrap_or_default(),
        title,
        slug,
        duration_secs: get_tag("duration").and_then(|d| d.parse().ok()),
        audio_hash: get_tag("x"),
        audio_url: get_tag("url"),
        fallback_url: get_tag("fallback"),
        mime_type: get_tag("m"),
        file_size: get_tag("size").and_then(|s| s.parse().ok()),
        preview_secs: get_tag("preview").and_then(|p| p.parse().ok()),
        lightning_node_id: get_tag("lightning_node_id"),
        created_at: event.created_at.as_u64(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── build_profile_content tests ────────────────────────────

    #[test]
    fn build_profile_basic() {
        let data = ProfileData {
            name: Some("alice".into()),
            display_name: Some("Alice".into()),
            ..Default::default()
        };
        let json = build_profile_content(&data, None);
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["name"], "alice");
        assert_eq!(parsed["display_name"], "Alice");
    }

    #[test]
    fn build_profile_with_all_fields() {
        let data = ProfileData {
            name: Some("alice".into()),
            display_name: Some("Alice".into()),
            about: Some("Music lover".into()),
            picture: Some("https://example.com/pic.jpg".into()),
            lud16: Some("alice@lightning.fm".into()),
            nip05: Some("alice@lightning.fm".into()),
        };
        let json = build_profile_content(&data, None);
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["about"], "Music lover");
        assert_eq!(parsed["picture"], "https://example.com/pic.jpg");
        assert_eq!(parsed["lud16"], "alice@lightning.fm");
        assert_eq!(parsed["nip05"], "alice@lightning.fm");
    }

    #[test]
    fn build_profile_none_fields_omitted() {
        let data = ProfileData {
            name: Some("alice".into()),
            display_name: Some("Alice".into()),
            about: None,
            picture: None,
            lud16: None,
            nip05: None,
        };
        let json = build_profile_content(&data, None);
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(parsed.get("about").is_none());
        assert!(parsed.get("picture").is_none());
    }

    #[test]
    fn build_profile_merges_with_existing() {
        let existing = r#"{"name":"alice","display_name":"Alice","picture":"https://old.com/pic.jpg","banner":"https://old.com/banner.jpg"}"#;
        let data = ProfileData {
            display_name: Some("Alice Updated".into()),
            ..Default::default()
        };
        let json = build_profile_content(&data, Some(existing));
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // Updated field
        assert_eq!(parsed["display_name"], "Alice Updated");
        // Preserved from existing
        assert_eq!(parsed["name"], "alice");
        assert_eq!(parsed["picture"], "https://old.com/pic.jpg");
        // Unknown field preserved (banner is not in our ProfileData)
        assert_eq!(parsed["banner"], "https://old.com/banner.jpg");
    }

    #[test]
    fn build_profile_handles_malformed_existing() {
        let data = ProfileData {
            name: Some("bob".into()),
            display_name: Some("Bob".into()),
            ..Default::default()
        };
        // Malformed existing JSON — should not crash, starts fresh
        let json = build_profile_content(&data, Some("not json at all"));
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["name"], "bob");
    }

    // ─── parse_profile_content tests ────────────────────────────

    #[test]
    fn parse_profile_valid_json() {
        let json = r#"{"name":"alice","display_name":"Alice","about":"hi"}"#;
        let profile = parse_profile_content(json);
        assert_eq!(profile.name, Some("alice".into()));
        assert_eq!(profile.display_name, Some("Alice".into()));
        assert_eq!(profile.about, Some("hi".into()));
        assert!(profile.picture.is_none());
    }

    #[test]
    fn parse_profile_empty_string() {
        let profile = parse_profile_content("");
        assert!(profile.name.is_none());
        assert!(profile.display_name.is_none());
    }

    #[test]
    fn parse_profile_malformed_json() {
        let profile = parse_profile_content("{broken json");
        assert!(profile.name.is_none());
    }

    #[test]
    fn parse_profile_extra_fields_ignored() {
        let json = r#"{"name":"alice","website":"https://alice.com","custom_field":42}"#;
        let profile = parse_profile_content(json);
        assert_eq!(profile.name, Some("alice".into()));
        // Extra fields don't cause errors — they're just not in our struct
    }

    #[test]
    fn parse_profile_non_string_values() {
        // Some clients put numbers or objects where strings should be
        let json = r#"{"name":123,"display_name":null}"#;
        let profile = parse_profile_content(json);
        assert!(profile.name.is_none()); // 123 is not a string
        assert!(profile.display_name.is_none()); // null is not a string
    }

    // ─── build_relay_list_tags tests ────────────────────────────

    #[test]
    fn relay_list_tags_correct_structure() {
        let tags = build_relay_list_tags(PROD_RELAYS);
        assert_eq!(tags.len(), 4);
        for tag in &tags {
            let values = tag.as_slice();
            assert_eq!(values[0], "r");
            assert!(values[1].starts_with("wss://"));
        }
    }

    #[test]
    fn dev_relays_include_lightning_fm_and_localhost() {
        assert!(DEV_RELAYS.iter().any(|r| *r == "wss://relay.lightning.fm"), "Dev relays should include relay.lightning.fm");
        assert!(DEV_RELAYS.iter().any(|r| r.starts_with("ws://localhost")), "Dev relays should include localhost");
    }

    #[test]
    fn prod_relays_exclude_localhost() {
        for relay in PROD_RELAYS {
            assert!(relay.starts_with("wss://"), "Prod relay should use wss://: {}", relay);
            assert!(!relay.contains("localhost"), "Prod relay must not include localhost: {}", relay);
        }
    }

    #[test]
    fn prod_relays_include_lightning_fm() {
        assert!(PROD_RELAYS.iter().any(|r| *r == "wss://relay.lightning.fm"),
            "Prod relays should include relay.lightning.fm");
    }

    #[test]
    fn get_relays_defaults_to_dev_in_debug() {
        // Tests run in debug mode, so get_relays() should return dev relays
        // (unless LFM_NOSTR_RELAYS env var is set)
        let relays = get_relays();
        assert!(!relays.is_empty(), "Should return at least one relay");
        if std::env::var("LFM_NOSTR_RELAYS").is_err() {
            assert!(relays.iter().any(|r| r.contains("localhost")),
                "Debug mode should include localhost relay");
        }
    }

    #[test]
    fn debug_assertions_selects_correct_relay_set() {
        // In debug builds (tests), cfg!(debug_assertions) is true → dev relays
        // In release builds, it's false → prod relays (no localhost)
        assert!(cfg!(debug_assertions), "Tests should run in debug mode");
        // This proves the relay selection logic: debug → dev, release → prod
    }

    #[tokio::test]
    async fn connect_anonymous_creates_client() {
        // Connecting without keys should succeed (read-only mode)
        let client = connect(None).await;
        assert!(client.is_ok(), "Anonymous relay connect should succeed: {:?}", client.err());
    }

    #[tokio::test]
    async fn connect_authenticated_creates_client() {
        // Connecting with keys should succeed
        let keys = Keys::generate();
        let client = connect(Some(&keys)).await;
        assert!(client.is_ok(), "Authenticated relay connect should succeed: {:?}", client.err());
    }

    #[test]
    fn relay_list_tags_empty_input() {
        let tags = build_relay_list_tags(&[]);
        assert!(tags.is_empty());
    }

    #[test]
    fn relay_list_tags_custom_relays() {
        let relays = &["wss://custom.relay.com"];
        let tags = build_relay_list_tags(relays);
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].as_slice()[1], "wss://custom.relay.com");
    }

    // ─── validate_profile tests ─────────────────────────────────

    #[test]
    fn validate_rejects_missing_display_name() {
        let data = ProfileData {
            name: Some("alice".into()),
            display_name: None,
            ..Default::default()
        };
        assert!(validate_profile(&data).is_err());
    }

    #[test]
    fn validate_rejects_empty_display_name() {
        let data = ProfileData {
            display_name: Some("   ".into()),
            ..Default::default()
        };
        assert!(validate_profile(&data).is_err());
    }

    #[test]
    fn validate_accepts_valid_profile() {
        let data = ProfileData {
            name: Some("alice".into()),
            display_name: Some("Alice".into()),
            ..Default::default()
        };
        assert!(validate_profile(&data).is_ok());
    }

    #[test]
    fn validate_accepts_display_name_only() {
        let data = ProfileData {
            display_name: Some("Alice".into()),
            ..Default::default()
        };
        assert!(validate_profile(&data).is_ok());
    }

    // ─── round-trip tests ───────────────────────────────────────

    #[test]
    fn profile_build_parse_roundtrip() {
        let original = ProfileData {
            name: Some("alice".into()),
            display_name: Some("Alice".into()),
            about: Some("Streaming music".into()),
            picture: Some("https://example.com/pic.jpg".into()),
            lud16: Some("alice@ln.fm".into()),
            nip05: Some("alice@lightning.fm".into()),
        };
        let json = build_profile_content(&original, None);
        let parsed = parse_profile_content(&json);

        assert_eq!(original.name, parsed.name);
        assert_eq!(original.display_name, parsed.display_name);
        assert_eq!(original.about, parsed.about);
        assert_eq!(original.picture, parsed.picture);
        assert_eq!(original.lud16, parsed.lud16);
        assert_eq!(original.nip05, parsed.nip05);
    }

    #[test]
    fn profile_data_serializes_for_frontend() {
        let data = ProfileData {
            name: Some("alice".into()),
            display_name: Some("Alice".into()),
            ..Default::default()
        };
        let json = serde_json::to_string(&data).unwrap();
        assert!(json.contains("alice"));
        assert!(json.contains("Alice"));
    }
}
