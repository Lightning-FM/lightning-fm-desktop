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

/// Hosted purchase gate by environment (Option 3 free tier).
/// Set LFM_gate_server to override.
pub fn get_gate_server() -> String {
    if let Ok(server) = std::env::var("LFM_gate_server") {
        return server;
    }
    if std::env::var("LFM_ENV").as_deref() == Ok("production") {
        return "https://lightning.fm/api/gate".to_string();
    }
    // Local dev — the marketing site's dev server
    "http://localhost:3020/api/gate".to_string()
}

/// Gate wallet-check result (Option 3, Phase 4). Extra fields the gate
/// returns (sendable range, checked_at) are ignored — the UI only needs
/// these.
#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct WalletCheck {
    pub ok: bool,
    pub lud16: String,
    pub provider: Option<String>,
    pub verify_supported: bool,
    pub error: Option<String>,
}

/// Ask the gate to probe a Lightning address: full LNURL-pay flow ending
/// in a real test invoice that is never paid. Callers must show the
/// transparency copy while this runs — the artist's wallet may display
/// the unpaid invoice, and nobody should wonder what it is.
pub async fn check_wallet(lud16: &str) -> Result<WalletCheck, String> {
    let base = get_gate_server().trim_end_matches('/').to_string();
    let response = reqwest::Client::new()
        .post(format!("{}/wallet-check", base))
        .header("Content-Type", "application/json")
        .body(serde_json::json!({ "lud16": lud16 }).to_string())
        .send()
        .await
        .map_err(|e| format!("Wallet check request failed: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Wallet check refused {}", error_body(response).await));
    }
    response
        .json::<WalletCheck>()
        .await
        .map_err(|e| format!("Wallet check returned an invalid response: {}", e))
}

/// Sign a NIP-98 (kind 27235) auth header for a gate request. The gate
/// binds the payload tag to sha256 of the exact body string sent.
fn nip98_header(
    keys: &Keys,
    url: &str,
    method: &str,
    payload_sha256: Option<String>,
) -> Result<String, String> {
    let mut tags = vec![
        Tag::custom(TagKind::custom("u"), vec![url.to_string()]),
        Tag::custom(TagKind::custom("method"), vec![method.to_string()]),
    ];
    if let Some(hash) = payload_sha256 {
        tags.push(Tag::custom(TagKind::custom("payload"), vec![hash]));
    }
    let event = EventBuilder::new(Kind::HttpAuth, "")
        .tags(tags)
        .sign_with_keys(keys)
        .map_err(|e| format!("Failed to sign NIP-98 event: {}", e))?;
    let event_json = serde_json::to_string(&event)
        .map_err(|e| format!("Failed to serialize NIP-98 event: {}", e))?;
    Ok(format!(
        "Nostr {}",
        base64::engine::general_purpose::STANDARD.encode(event_json.as_bytes())
    ))
}

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

async fn error_body(response: reqwest::Response) -> String {
    let status = response.status();
    // The gate's error strings are artist-facing — surface them verbatim.
    let body = response.text().await.unwrap_or_default();
    let msg = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(String::from))
        .unwrap_or(body);
    format!("({}) {}", status, msg)
}

/// Sell through the hosted gate (Option 3): presigned upload of the
/// artifact straight to Lightning FM's private storage, then product
/// registration over NIP-98. The payout address is whatever lud16 the
/// artist's Nostr profile carries — the gate accepts nothing else.
/// Returns the gate endpoint for the listing's `endpoint` tag.
pub async fn upload_artifact_to_gate(
    file_path: &Path,
    keys: &Keys,
    slug: &str,
    title: &str,
    price_sats: u64,
    floor_sats: Option<u64>,
    format: &str,
) -> Result<String, String> {
    let base = get_gate_server().trim_end_matches('/').to_string();
    let bytes = std::fs::read(file_path)
        .map_err(|e| format!("Failed to read artifact: {}", e))?;
    let sha256 = sha256_hex(&bytes);
    let size_bytes = bytes.len() as u64;
    let client = reqwest::Client::new();

    // 1. Ask for a presigned upload slot (NIP-98 over the JSON body)
    let uploads_url = format!("{}/uploads", base);
    let upload_req = serde_json::json!({ "sha256": sha256, "size_bytes": size_bytes }).to_string();
    let auth = nip98_header(keys, &uploads_url, "POST", Some(sha256_hex(upload_req.as_bytes())))?;
    let response = client
        .post(&uploads_url)
        .header("Authorization", auth)
        .header("Content-Type", "application/json")
        .body(upload_req)
        .send()
        .await
        .map_err(|e| format!("Gate upload request failed: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Gate refused the upload {}", error_body(response).await));
    }
    #[derive(serde::Deserialize)]
    struct UploadSlot {
        upload_url: String,
        artifact_url: String,
    }
    let slot: UploadSlot = response
        .json()
        .await
        .map_err(|e| format!("Gate returned an invalid upload slot: {}", e))?;

    // 2. Send the file straight to storage — the presigned URL is the auth
    let response = client
        .put(&slot.upload_url)
        .header("Content-Type", "application/octet-stream")
        .body(bytes)
        .send()
        .await
        .map_err(|e| format!("Artifact upload failed: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Storage rejected the artifact {}", error_body(response).await));
    }

    // 3. Register the product (NIP-98 over the JSON body)
    let product_url = format!("{}/products/{}", base, slug);
    let product_req = serde_json::json!({
        "title": title,
        "price_sats": price_sats,
        "floor_sats": floor_sats,
        "format": format,
        "size_bytes": size_bytes,
        "artifact_url": slot.artifact_url,
    })
    .to_string();
    let auth = nip98_header(keys, &product_url, "PUT", Some(sha256_hex(product_req.as_bytes())))?;
    let response = client
        .put(&product_url)
        .header("Authorization", auth)
        .header("Content-Type", "application/json")
        .body(product_req)
        .send()
        .await
        .map_err(|e| format!("Product registration failed: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Gate refused the product {}", error_body(response).await));
    }

    log::info!("Artifact '{}' registered with the hosted gate {}", slug, base);
    Ok(base)
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Cross-implementation check: our nostr-sdk-signed NIP-98 token must
    /// verify against the production gate's nostr-tools-based verifier. A
    /// throwaway key is valid but not allowlisted, so the expected result
    /// is the allowlist 403 — reaching it proves auth verified.
    /// Network test — run explicitly: cargo test gate_nip98 -- --ignored
    #[test]
    #[ignore]
    fn gate_nip98_interop_against_production() {
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        rt.block_on(async {
            let keys = Keys::generate();
            let tmp = std::env::temp_dir().join("lfm-gate-interop-test.bin");
            std::fs::write(&tmp, b"interop test artifact").expect("write temp file");
            std::env::set_var("LFM_gate_server", "https://lightning.fm/api/gate");

            let err = upload_artifact_to_gate(
                &tmp, &keys, "interop-test", "Interop Test", 100, None, "mp3",
            )
            .await
            .expect_err("un-allowlisted key must be refused");

            assert!(
                err.contains("allowlist"),
                "expected the allowlist refusal (proves NIP-98 verified), got: {err}"
            );
        });
    }
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
