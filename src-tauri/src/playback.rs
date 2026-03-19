// Lightning FM — Audio playback engine
// Handles the three-tier fetch chain: local cache → artist P2P → Blossom mirror.
// Returns a local file path that the React frontend plays via <audio>.

use sha2::{Sha256, Digest};
use std::path::PathBuf;

/// Audio cache directory: ~/.lightning-fm/audio/
fn cache_dir() -> PathBuf {
    let home = dirs::home_dir().expect("Could not determine home directory");
    home.join(".lightning-fm").join("audio")
}

/// Get the cached file path for a given audio hash
fn cached_path(hash: &str) -> PathBuf {
    cache_dir().join(hash)
}

/// Check if a track is already cached locally
pub fn is_cached(hash: &str) -> bool {
    cached_path(hash).exists()
}

/// Get the local file path for a cached track
pub fn get_cached_path(hash: &str) -> Option<String> {
    let path = cached_path(hash);
    if path.exists() {
        Some(path.to_string_lossy().to_string())
    } else {
        None
    }
}

/// Fetch audio and cache it locally. Tries URLs in order (artist P2P first, mirror fallback).
/// Returns the local cache path and whether it was served from the artist directly.
pub async fn fetch_and_cache(
    hash: &str,
    urls: Vec<String>,
) -> Result<(String, bool), String> {
    // Check cache first
    if let Some(path) = get_cached_path(hash) {
        log::info!("Cache hit for {}", hash);
        return Ok((path, false)); // can't determine source from cache
    }

    // Ensure cache directory exists
    std::fs::create_dir_all(cache_dir())
        .map_err(|e| format!("Failed to create cache dir: {}", e))?;

    let client = reqwest::Client::new();

    // Try each URL in order — first is artist P2P, last is mirror
    for (i, url) in urls.iter().enumerate() {
        let is_artist_direct = i == 0 && urls.len() > 1;

        match client.get(url).send().await {
            Ok(response) if response.status().is_success() => {
                let bytes = response.bytes().await
                    .map_err(|e| format!("Failed to read audio bytes: {}", e))?;

                // Verify hash matches content
                let mut hasher = Sha256::new();
                hasher.update(&bytes);
                let computed_hash = format!("{:x}", hasher.finalize());

                if computed_hash != hash {
                    log::warn!(
                        "Hash mismatch from {}: expected {}, got {}",
                        url, hash, computed_hash
                    );
                    continue; // try next URL
                }

                // Write to cache
                let cache_path = cached_path(hash);
                std::fs::write(&cache_path, &bytes)
                    .map_err(|e| format!("Failed to write cache: {}", e))?;

                log::info!(
                    "Fetched and cached {} from {} ({})",
                    hash,
                    url,
                    if is_artist_direct { "artist direct" } else { "mirror" }
                );

                return Ok((cache_path.to_string_lossy().to_string(), is_artist_direct));
            }
            Ok(response) => {
                log::warn!("HTTP {} from {}", response.status(), url);
                continue;
            }
            Err(e) => {
                log::warn!("Failed to fetch from {}: {}", url, e);
                continue;
            }
        }
    }

    Err(format!("All sources failed for hash {}", hash))
}

/// Load a track directly from a local file path (for dev/testing with test-data/).
/// Copies to cache and returns the cache path.
pub fn load_local_file(file_path: &str) -> Result<(String, String), String> {
    let path = std::path::Path::new(file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let bytes = std::fs::read(path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    // Compute hash
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let hash = format!("{:x}", hasher.finalize());

    // Cache it
    std::fs::create_dir_all(cache_dir())
        .map_err(|e| format!("Failed to create cache dir: {}", e))?;

    let cache_path = cached_path(&hash);
    if !cache_path.exists() {
        std::fs::write(&cache_path, &bytes)
            .map_err(|e| format!("Failed to write cache: {}", e))?;
    }

    Ok((hash, cache_path.to_string_lossy().to_string()))
}

/// Get cache stats
pub fn cache_stats() -> (usize, u64) {
    let dir = cache_dir();
    if !dir.exists() {
        return (0, 0);
    }

    let mut count = 0usize;
    let mut total_size = 0u64;

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    count += 1;
                    total_size += meta.len();
                }
            }
        }
    }

    (count, total_size)
}
