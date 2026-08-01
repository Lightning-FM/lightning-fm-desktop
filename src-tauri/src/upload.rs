// Lightning FM — Audio file upload to Blossom
// Handles SHA-256 hashing, Blossom auth (kind 24242), and HTTP upload.

use nostr_sdk::prelude::*;
use base64::Engine;
use sha2::{Sha256, Digest};
use serde::Serialize;
use std::path::Path;

/// Blossom server by environment.
/// Set LFM_blossom_server env var to override.
/// Default: localhost for dev. Production only when LFM_ENV=production.
fn get_blossom_server() -> String {
    if let Ok(server) = std::env::var("LFM_blossom_server") {
        return server;
    }
    if std::env::var("LFM_ENV").as_deref() == Ok("production") {
        return "https://media.lightning.fm".to_string();
    }
    // Local dev — assumes a local Blossom server
    "http://localhost:3000".to_string()
}

/// Kind 24242 — Blossom upload authorization
const KIND_BLOSSOM_AUTH: u16 = 24242;

/// Result of uploading a file to Blossom
#[derive(Serialize)]
pub struct UploadResult {
    pub sha256: String,
    pub url: String,
    pub size: u64,
    pub mime_type: String,
}

/// Compute SHA-256 hash of a file
pub fn hash_file(path: &Path) -> Result<(String, u64), String> {
    let bytes = std::fs::read(path)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    let size = bytes.len() as u64;

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let hash = format!("{:x}", hasher.finalize());

    Ok((hash, size))
}

/// Detect MIME type from file extension
pub fn detect_mime(path: &Path) -> String {
    match path.extension().and_then(|e| e.to_str()) {
        Some("mp3") => "audio/mpeg".to_string(),
        Some("flac") => "audio/flac".to_string(),
        Some("ogg") => "audio/ogg".to_string(),
        Some("wav") => "audio/wav".to_string(),
        Some("m4a") => "audio/mp4".to_string(),
        Some("aac") => "audio/aac".to_string(),
        Some("opus") => "audio/opus".to_string(),
        Some("webm") => "audio/webm".to_string(),
        _ => "application/octet-stream".to_string(),
    }
}

/// Create a signed Blossom auth event (kind 24242) for uploading
pub async fn create_blossom_auth(
    keys: &Keys,
    sha256: &str,
    size: u64,
) -> Result<String, String> {
    let now = Timestamp::now();
    let expiry = Timestamp::from(now.as_u64() + 300); // 5 minutes

    let tags = vec![
        Tag::custom(TagKind::custom("t"), vec!["upload".to_string()]),
        Tag::custom(TagKind::custom("x"), vec![sha256.to_string()]),
        Tag::custom(TagKind::custom("size"), vec![size.to_string()]),
        Tag::custom(TagKind::custom("expiration"), vec![expiry.as_u64().to_string()]),
    ];

    let event = EventBuilder::new(Kind::Custom(KIND_BLOSSOM_AUTH), "Upload to Lightning FM")
        .tags(tags)
        .sign_with_keys(keys)
        .map_err(|e| format!("Failed to sign auth event: {}", e))?;

    // Blossom expects the event JSON base64-encoded in the Authorization header
    let event_json = serde_json::to_string(&event)
        .map_err(|e| format!("Failed to serialize auth event: {}", e))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(event_json.as_bytes());

    Ok(encoded)
}

/// Upload a purchasable artifact (lossless file) to the artist's seller
/// daemon, authenticated with NIP-98 (kind 27235). The daemon verifies the
/// signer against its configured ARTIST_PUBKEY and the payload hash against
/// the body, then registers the product for the L402 purchase gate.
pub async fn upload_artifact_to_daemon(
    file_path: &Path,
    keys: &Keys,
    endpoint: &str,
    slug: &str,
    title: &str,
    price_sats: u64,
    floor_sats: Option<u64>,
    format: &str,
) -> Result<(), String> {
    let (sha256, _size) = hash_file(file_path)?;
    let base = endpoint.trim_end_matches('/');
    // Must match the daemon's NIP-98 expected_url exactly (no query string)
    let auth_url = format!("{}/products/{}", base, slug);

    let tags = vec![
        Tag::custom(TagKind::custom("u"), vec![auth_url.clone()]),
        Tag::custom(TagKind::custom("method"), vec!["PUT".to_string()]),
        Tag::custom(TagKind::custom("payload"), vec![sha256.clone()]),
    ];
    let event = EventBuilder::new(Kind::HttpAuth, "")
        .tags(tags)
        .sign_with_keys(keys)
        .map_err(|e| format!("Failed to sign NIP-98 event: {}", e))?;
    let event_json = serde_json::to_string(&event)
        .map_err(|e| format!("Failed to serialize NIP-98 event: {}", e))?;
    let auth = base64::engine::general_purpose::STANDARD.encode(event_json.as_bytes());

    let bytes = std::fs::read(file_path)
        .map_err(|e| format!("Failed to read artifact: {}", e))?;

    let mut query: Vec<(&str, String)> = vec![
        ("title", title.to_string()),
        ("price_sats", price_sats.to_string()),
        ("format", format.to_string()),
    ];
    if let Some(floor) = floor_sats {
        query.push(("floor_sats", floor.to_string()));
    }

    let client = reqwest::Client::new();
    let response = client
        .put(&auth_url)
        .query(&query)
        .header("Authorization", format!("Nostr {}", auth))
        .header("Content-Type", "application/octet-stream")
        .body(bytes)
        .send()
        .await
        .map_err(|e| format!("Artifact upload request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Artifact upload failed ({}): {}", status, body));
    }

    log::info!("Artifact '{}' uploaded to seller daemon {}", slug, base);
    Ok(())
}

/// Upload a file to the Blossom server
pub async fn upload_to_blossom(
    file_path: &Path,
    keys: &Keys,
) -> Result<UploadResult, String> {
    let mime_type = detect_mime(file_path);
    let bytes = std::fs::read(file_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    upload_bytes_to_blossom(bytes, mime_type, keys).await
}

/// Upload raw bytes to the Blossom server. Used for audio files read from
/// disk and for artwork extracted out of their tags.
pub async fn upload_bytes_to_blossom(
    bytes: Vec<u8>,
    mime_type: String,
    keys: &Keys,
) -> Result<UploadResult, String> {
    let blossom_server = get_blossom_server();
    let size = bytes.len() as u64;

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let sha256 = format!("{:x}", hasher.finalize());

    // Create signed Blossom auth
    let auth_token = create_blossom_auth(keys, &sha256, size).await?;

    // Upload via HTTP PUT
    let client = reqwest::Client::new();
    let response = client
        .put(format!("{}/upload", blossom_server))
        .header("Authorization", format!("Nostr {}", auth_token))
        .header("Content-Type", &mime_type)
        // BUD-11: servers require the hash up front and match it against the
        // auth event's x tag before reading the body.
        .header("X-SHA-256", &sha256)
        .body(bytes)
        .send()
        .await
        .map_err(|e| format!("Upload request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Upload failed ({}): {}", status, body));
    }

    let url = format!("{}/{}", blossom_server, sha256);
    log::info!("Uploaded {} bytes ({}) to {}", size, mime_type, url);

    Ok(UploadResult {
        sha256,
        url,
        size,
        mime_type,
    })
}
