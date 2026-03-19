// Lightning FM — Audio playback engine
// Handles the three-tier fetch chain: local cache → artist P2P → Blossom mirror.
// Returns a local file path that the React frontend plays via <audio>.

use base64::Engine;
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

/// Read audio file as base64 data URL for browser playback.
/// Bypasses asset protocol scope issues entirely.
pub fn read_audio_base64(file_path: &str) -> Result<String, String> {
    let path = std::path::Path::new(file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let bytes = std::fs::read(path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let mime = match path.extension().and_then(|e| e.to_str()) {
        Some("mp3") => "audio/mpeg",
        Some("flac") => "audio/flac",
        Some("ogg") => "audio/ogg",
        Some("wav") => "audio/wav",
        _ => "audio/mpeg",
    };

    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // ─── SHA-256 hashing tests ───────────────────────────────────

    #[test]
    fn hash_is_deterministic() {
        let data = b"hello lightning fm";
        let mut h1 = Sha256::new();
        h1.update(data);
        let hash1 = format!("{:x}", h1.finalize());

        let mut h2 = Sha256::new();
        h2.update(data);
        let hash2 = format!("{:x}", h2.finalize());

        assert_eq!(hash1, hash2, "Same data should produce same hash");
        assert_eq!(hash1.len(), 64, "SHA-256 hex should be 64 chars");
    }

    #[test]
    fn different_data_different_hash() {
        let mut h1 = Sha256::new();
        h1.update(b"track one");
        let hash1 = format!("{:x}", h1.finalize());

        let mut h2 = Sha256::new();
        h2.update(b"track two");
        let hash2 = format!("{:x}", h2.finalize());

        assert_ne!(hash1, hash2, "Different data should produce different hashes");
    }

    // ─── Local file loading tests ────────────────────────────────

    #[test]
    fn load_local_file_returns_hash_and_path() {
        // Create a temp file with known content
        let tmp = std::env::temp_dir().join("lfm-test-audio.mp3");
        fs::write(&tmp, b"fake mp3 content for testing").unwrap();

        let result = load_local_file(tmp.to_str().unwrap());
        assert!(result.is_ok(), "Should load local file");

        let (hash, path) = result.unwrap();
        assert_eq!(hash.len(), 64, "Hash should be 64 hex chars");
        assert!(path.contains(&hash), "Cache path should contain the hash");

        // Verify the cached file exists and matches
        assert!(std::path::Path::new(&path).exists(), "Cached file should exist");
        let cached_bytes = fs::read(&path).unwrap();
        assert_eq!(cached_bytes, b"fake mp3 content for testing");

        // Cleanup
        let _ = fs::remove_file(&tmp);
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn load_local_file_is_idempotent() {
        let tmp = std::env::temp_dir().join("lfm-test-idempotent.mp3");
        fs::write(&tmp, b"idempotent test content").unwrap();

        let (hash1, path1) = load_local_file(tmp.to_str().unwrap()).unwrap();
        let (hash2, path2) = load_local_file(tmp.to_str().unwrap()).unwrap();

        assert_eq!(hash1, hash2, "Same file should produce same hash");
        assert_eq!(path1, path2, "Same file should produce same cache path");

        let _ = fs::remove_file(&tmp);
        let _ = fs::remove_file(&path1);
    }

    #[test]
    fn load_local_file_rejects_missing_file() {
        let result = load_local_file("/nonexistent/path/fake.mp3");
        assert!(result.is_err(), "Should error on missing file");
        assert!(result.unwrap_err().contains("File not found"));
    }

    // ─── Cache lookup tests ──────────────────────────────────────

    #[test]
    fn is_cached_returns_false_for_unknown_hash() {
        assert!(!is_cached("0000000000000000000000000000000000000000000000000000000000000000"));
    }

    #[test]
    fn get_cached_path_returns_none_for_unknown() {
        let result = get_cached_path("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
        assert!(result.is_none(), "Should return None for uncached hash");
    }

    #[test]
    fn load_then_cache_check_works() {
        let tmp = std::env::temp_dir().join("lfm-test-cache-check.mp3");
        fs::write(&tmp, b"cache check test data").unwrap();

        let (hash, _path) = load_local_file(tmp.to_str().unwrap()).unwrap();

        assert!(is_cached(&hash), "Should be cached after load_local_file");
        assert!(get_cached_path(&hash).is_some(), "Should return path for cached hash");

        // Cleanup
        let _ = fs::remove_file(&tmp);
        let _ = fs::remove_file(cached_path(&hash));
    }

    // ─── Cache stats tests ───────────────────────────────────────

    #[test]
    fn cache_stats_counts_files() {
        // Load a file to ensure at least one cache entry
        let tmp = std::env::temp_dir().join("lfm-test-stats.mp3");
        fs::write(&tmp, b"stats test data").unwrap();
        let (hash, _) = load_local_file(tmp.to_str().unwrap()).unwrap();

        let (count, total_bytes) = cache_stats();
        assert!(count >= 1, "Should have at least 1 cached file");
        assert!(total_bytes >= 15, "Should have at least 15 bytes cached");

        // Cleanup
        let _ = fs::remove_file(&tmp);
        let _ = fs::remove_file(cached_path(&hash));
    }
}
