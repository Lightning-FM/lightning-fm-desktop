// Lightning FM — Audio file upload to Blossom
// Handles SHA-256 hashing, Blossom auth (kind 24242), and HTTP upload.

use nostr_sdk::prelude::*;
use base64::Engine;
use sha2::{Sha256, Digest};
use serde::Serialize;
use std::path::Path;

/// Lightning FM's Blossom server
const BLOSSOM_SERVER: &str = "https://media.lightning.fm";

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

/// Upload a file to the Blossom server
pub async fn upload_to_blossom(
    file_path: &Path,
    keys: &Keys,
) -> Result<UploadResult, String> {
    let (sha256, size) = hash_file(file_path)?;
    let mime_type = detect_mime(file_path);

    // Create signed Blossom auth
    let auth_token = create_blossom_auth(keys, &sha256, size).await?;

    // Read file bytes
    let bytes = std::fs::read(file_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    // Upload via HTTP PUT
    let client = reqwest::Client::new();
    let response = client
        .put(format!("{}/upload", BLOSSOM_SERVER))
        .header("Authorization", format!("Nostr {}", auth_token))
        .header("Content-Type", &mime_type)
        .body(bytes)
        .send()
        .await
        .map_err(|e| format!("Upload request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Upload failed ({}): {}", status, body));
    }

    let url = format!("{}/{}", BLOSSOM_SERVER, sha256);
    log::info!("Uploaded {} to {}", file_path.display(), url);

    Ok(UploadResult {
        sha256,
        url,
        size,
        mime_type,
    })
}
