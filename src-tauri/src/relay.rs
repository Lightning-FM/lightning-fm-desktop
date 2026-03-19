// Lightning FM — Nostr relay connection and event management
// Handles connecting to relays, subscribing to track events (kind 31337),
// and publishing events.

use nostr_sdk::prelude::*;
use serde::Serialize;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

/// Default relays for Lightning FM
const DEFAULT_RELAYS: &[&str] = &[
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.nostr.band",
];

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
    pub created_at: u64,
}

/// Connect to Nostr relays with the user's keys
pub async fn connect(keys: &Keys) -> Result<Arc<Client>, String> {
    let client = Client::new(keys.clone());

    for relay in DEFAULT_RELAYS {
        client.add_relay(*relay).await
            .map_err(|e| format!("Failed to add relay {}: {}", relay, e))?;
    }

    client.connect().await;
    log::info!("Connected to {} relays", DEFAULT_RELAYS.len());

    Ok(Arc::new(client))
}

/// Fetch all tracks from relays (kind 31337 addressable events)
pub async fn fetch_tracks(client: &Client) -> Result<Vec<TrackInfo>, String> {
    let filter = Filter::new()
        .kind(Kind::Custom(KIND_TRACK))
        .limit(100);

    let events = client
        .fetch_events(filter, std::time::Duration::from_secs(10))
        .await
        .map_err(|e| format!("Failed to fetch tracks: {}", e))?;

    let tracks: Vec<TrackInfo> = events
        .iter()
        .filter_map(|event| parse_track_event(event))
        .collect();

    log::info!("Fetched {} tracks from relays", tracks.len());
    Ok(tracks)
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

    let builder = EventBuilder::new(Kind::Custom(KIND_TRACK), "")
        .tags(tags);

    let output = client.send_event_builder(builder).await
        .map_err(|e| format!("Failed to publish track: {}", e))?;

    let event_id = output.id().to_hex();
    log::info!("Published track '{}' as event {}", title, event_id);
    Ok(event_id)
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
        created_at: event.created_at.as_u64(),
    })
}
