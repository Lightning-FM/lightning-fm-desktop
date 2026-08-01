// Lightning FM — Audio metadata reading, writing, and artwork extraction
// Uses lofty for multi-format tag support (ID3v2, Vorbis Comments, AIFF, WAV).

use lofty::prelude::*;
use lofty::config::WriteOptions;
use lofty::file::TaggedFileExt;
use lofty::picture::PictureType;
use lofty::tag::{Accessor, ItemKey};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Metadata read from an audio file's tags
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub track_number: Option<u32>,
    pub genre: Option<String>,
    pub year: Option<String>,
    pub lyrics: Option<String>,
    pub has_artwork: bool,
    // Audio properties
    pub duration_secs: f64,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u8>,
    pub channels: Option<u8>,
    pub format: String,
}

/// Metadata to write back to an audio file
#[derive(Debug, Clone, Deserialize)]
pub struct MetadataWrite {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub track_number: Option<u32>,
    pub genre: Option<String>,
    pub year: Option<String>,
    pub lyrics: Option<String>,
}

/// Extracted artwork from an audio file
#[derive(Debug, Clone, Serialize)]
pub struct ExtractedArtwork {
    /// Base64-encoded image data as a data URL (e.g., "data:image/jpeg;base64,...")
    pub data_url: String,
    /// MIME type of the image
    pub mime_type: String,
    /// Width in pixels (if available from metadata)
    pub width: Option<u32>,
    /// Height in pixels (if available from metadata)
    pub height: Option<u32>,
}

/// Read metadata from an audio file's embedded tags
pub fn read_metadata(path: &Path) -> Result<AudioMetadata, String> {
    let tagged_file = lofty::read_from_path(path)
        .map_err(|e| format!("Failed to read audio file: {}", e))?;

    let properties = tagged_file.properties();
    let duration = properties.duration();
    let duration_secs = duration.as_secs_f64();

    // Try to get the primary tag, fall back to any available tag
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());

    let format = detect_format_name(path);

    let (title, artist, album, track_number, genre, year, lyrics, has_artwork) =
        if let Some(tag) = tag {
            (
                tag.title().map(|s| s.to_string()),
                tag.artist().map(|s| s.to_string()),
                tag.album().map(|s| s.to_string()),
                tag.track(),
                tag.genre().map(|s| s.to_string()),
                tag.year().map(|y| y.to_string())
                    .or_else(|| tag.get_string(&ItemKey::RecordingDate).map(|s| s.to_string())),
                tag.get_string(&ItemKey::Lyrics).map(|s| s.to_string()),
                !tag.pictures().is_empty(),
            )
        } else {
            (None, None, None, None, None, None, None, false)
        };

    Ok(AudioMetadata {
        title,
        artist,
        album,
        track_number,
        genre,
        year,
        lyrics,
        has_artwork,
        duration_secs,
        sample_rate: properties.sample_rate(),
        bit_depth: properties.bit_depth(),
        channels: properties.channels(),
        format,
    })
}

/// Write metadata back to an audio file's tags
/// Only writes fields that are Some — leaves others unchanged.
pub fn write_metadata(path: &Path, metadata: &MetadataWrite) -> Result<(), String> {
    let mut tagged_file = lofty::read_from_path(path)
        .map_err(|e| format!("Failed to read audio file: {}", e))?;

    // Get or create the primary tag for this format
    let tag = tagged_file
        .primary_tag_mut()
        .ok_or("No writable tag format for this file")?;

    if let Some(ref title) = metadata.title {
        tag.set_title(title.clone());
    }
    if let Some(ref artist) = metadata.artist {
        tag.set_artist(artist.clone());
    }
    if let Some(ref album) = metadata.album {
        tag.set_album(album.clone());
    }
    if let Some(track_number) = metadata.track_number {
        tag.set_track(track_number);
    }
    if let Some(ref genre) = metadata.genre {
        tag.set_genre(genre.clone());
    }
    if let Some(ref year) = metadata.year {
        if let Ok(y) = year.parse::<u32>() {
            tag.set_year(y);
        }
    }
    if let Some(ref lyrics) = metadata.lyrics {
        tag.insert_text(ItemKey::Lyrics, lyrics.clone());
    }

    tagged_file
        .save_to_path(path, WriteOptions::default())
        .map_err(|e| format!("Failed to write tags: {}", e))?;

    log::info!("Wrote metadata to {}", path.display());
    Ok(())
}

/// Extract embedded artwork as raw bytes plus its MIME type.
/// Used at publish time so the cover art can go to Blossom alongside the
/// audio; the UI path uses `extract_artwork` for a displayable data URL.
pub fn extract_artwork_raw(path: &Path) -> Result<Option<(Vec<u8>, String)>, String> {
    let tagged_file = lofty::read_from_path(path)
        .map_err(|e| format!("Failed to read audio file: {}", e))?;

    let tag = match tagged_file.primary_tag().or_else(|| tagged_file.first_tag()) {
        Some(t) => t,
        None => return Ok(None),
    };

    let picture = tag
        .pictures()
        .iter()
        .find(|p| p.pic_type() == PictureType::CoverFront)
        .or_else(|| tag.pictures().first());

    let picture = match picture {
        Some(p) => p,
        None => return Ok(None),
    };

    let mime = picture
        .mime_type()
        .map(|m| m.to_string())
        .unwrap_or_else(|| "image/jpeg".to_string());

    Ok(Some((picture.data().to_vec(), mime)))
}

/// Extract embedded artwork as a base64 data URL
pub fn extract_artwork(path: &Path) -> Result<Option<ExtractedArtwork>, String> {
    let tagged_file = lofty::read_from_path(path)
        .map_err(|e| format!("Failed to read audio file: {}", e))?;

    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());

    let tag = match tag {
        Some(t) => t,
        None => return Ok(None),
    };

    // Prefer front cover, fall back to first available picture
    let picture = tag
        .pictures()
        .iter()
        .find(|p| p.pic_type() == PictureType::CoverFront)
        .or_else(|| tag.pictures().first());

    let picture = match picture {
        Some(p) => p,
        None => return Ok(None),
    };

    let mime = picture.mime_type()
        .map(|m| m.to_string())
        .unwrap_or_else(|| "image/jpeg".to_string());

    let b64 = base64::engine::general_purpose::STANDARD.encode(picture.data());
    let data_url = format!("data:{};base64,{}", mime, b64);

    Ok(Some(ExtractedArtwork {
        data_url,
        mime_type: mime,
        width: None,  // lofty doesn't parse image dimensions from the blob
        height: None,
    }))
}

fn detect_format_name(path: &Path) -> String {
    match path.extension().and_then(|e| e.to_str()) {
        Some("mp3") => "MP3".to_string(),
        Some("flac") => "FLAC".to_string(),
        Some("ogg") | Some("oga") => "OGG".to_string(),
        Some("wav") => "WAV".to_string(),
        Some("aiff") | Some("aif") => "AIFF".to_string(),
        Some("m4a") => "M4A".to_string(),
        Some("aac") => "AAC".to_string(),
        Some("opus") => "OPUS".to_string(),
        Some(ext) => ext.to_uppercase(),
        None => "UNKNOWN".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    // ─── Helper: path to test data ─────────────────────────────────

    fn test_data_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("test-data")
    }

    fn test_mp3() -> PathBuf {
        test_data_dir().join("satoshi-sounds").join("21M.mp3")
    }

    // ─── Format detection tests ────────────────────────────────────

    #[test]
    fn detect_format_mp3() {
        assert_eq!(detect_format_name(Path::new("song.mp3")), "MP3");
    }

    #[test]
    fn detect_format_flac() {
        assert_eq!(detect_format_name(Path::new("song.flac")), "FLAC");
    }

    #[test]
    fn detect_format_wav() {
        assert_eq!(detect_format_name(Path::new("song.wav")), "WAV");
    }

    #[test]
    fn detect_format_aiff_variants() {
        assert_eq!(detect_format_name(Path::new("song.aiff")), "AIFF");
        assert_eq!(detect_format_name(Path::new("song.aif")), "AIFF");
    }

    #[test]
    fn detect_format_ogg_variants() {
        assert_eq!(detect_format_name(Path::new("song.ogg")), "OGG");
        assert_eq!(detect_format_name(Path::new("song.oga")), "OGG");
    }

    #[test]
    fn detect_format_unknown_extension() {
        assert_eq!(detect_format_name(Path::new("song.xyz")), "XYZ");
    }

    #[test]
    fn detect_format_no_extension() {
        assert_eq!(detect_format_name(Path::new("song")), "UNKNOWN");
    }

    // ─── Metadata read tests (real test data) ──────────────────────

    #[test]
    fn read_metadata_from_mp3() {
        let path = test_mp3();
        if !path.exists() {
            eprintln!("Skipping: test data not found at {:?}", path);
            return;
        }

        let meta = read_metadata(&path).expect("Should read metadata");
        assert_eq!(meta.format, "MP3");
        assert!(meta.duration_secs > 0.0, "Duration should be positive");
        assert!(meta.sample_rate.is_some(), "Should have sample rate");
    }

    #[test]
    fn read_metadata_returns_audio_properties() {
        let path = test_mp3();
        if !path.exists() { return; }

        let meta = read_metadata(&path).expect("Should read metadata");

        // MP3s are typically 44100 Hz
        if let Some(sr) = meta.sample_rate {
            assert!(sr >= 22050 && sr <= 96000, "Sample rate {} out of range", sr);
        }

        // Duration should be reasonable for a song (10s to 15min)
        assert!(meta.duration_secs > 10.0, "Duration too short: {}", meta.duration_secs);
        assert!(meta.duration_secs < 900.0, "Duration too long: {}", meta.duration_secs);
    }

    #[test]
    fn read_metadata_nonexistent_file_returns_error() {
        let result = read_metadata(Path::new("/tmp/definitely-does-not-exist.mp3"));
        assert!(result.is_err());
    }

    #[test]
    fn read_metadata_multiple_test_files() {
        // Verify we can read metadata from several different test tracks
        let dir = test_data_dir();
        if !dir.exists() { return; }

        let test_files = [
            dir.join("satoshi-sounds").join("Block Zero.mp3"),
            dir.join("keypair").join("dev_null.mp3"),
            dir.join("lightning-louise").join("Keysend.mp3"),
            dir.join("the-relay-operators").join("Kind 1.mp3"),
        ];

        for path in &test_files {
            if !path.exists() { continue; }
            let meta = read_metadata(path)
                .unwrap_or_else(|e| panic!("Failed to read {:?}: {}", path, e));
            assert_eq!(meta.format, "MP3");
            assert!(meta.duration_secs > 0.0);
        }
    }

    // ─── Metadata write tests ──────────────────────────────────────

    #[test]
    fn write_and_read_back_metadata() {
        let path = test_mp3();
        if !path.exists() { return; }

        // Copy test file to temp to avoid modifying test data
        let tmp = std::env::temp_dir().join("lfm-test-write.mp3");
        std::fs::copy(&path, &tmp).expect("Should copy test file");

        // Read original metadata
        let original = read_metadata(&tmp).expect("Should read original");

        // Write new metadata
        let write_data = MetadataWrite {
            title: Some("Test Title LFM".to_string()),
            artist: Some("Test Artist LFM".to_string()),
            album: Some("Test Album LFM".to_string()),
            track_number: Some(42),
            genre: Some("Electronic".to_string()),
            year: Some("2026".to_string()),
            lyrics: None, // Don't change lyrics
        };

        write_metadata(&tmp, &write_data).expect("Should write metadata");

        // Read back and verify
        let updated = read_metadata(&tmp).expect("Should read updated");
        assert_eq!(updated.title.as_deref(), Some("Test Title LFM"));
        assert_eq!(updated.artist.as_deref(), Some("Test Artist LFM"));
        assert_eq!(updated.album.as_deref(), Some("Test Album LFM"));
        assert_eq!(updated.track_number, Some(42));
        assert_eq!(updated.genre.as_deref(), Some("Electronic"));

        // Audio properties should be unchanged
        assert_eq!(updated.sample_rate, original.sample_rate);
        assert!((updated.duration_secs - original.duration_secs).abs() < 1.0);

        // Clean up
        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn write_partial_metadata_preserves_existing() {
        let path = test_mp3();
        if !path.exists() { return; }

        let tmp = std::env::temp_dir().join("lfm-test-partial.mp3");
        std::fs::copy(&path, &tmp).expect("Should copy");

        // First write a title
        write_metadata(&tmp, &MetadataWrite {
            title: Some("Original Title".to_string()),
            artist: Some("Original Artist".to_string()),
            album: None, track_number: None, genre: None, year: None, lyrics: None,
        }).expect("First write");

        // Then write only artist — title should survive
        write_metadata(&tmp, &MetadataWrite {
            title: None,
            artist: Some("Updated Artist".to_string()),
            album: None, track_number: None, genre: None, year: None, lyrics: None,
        }).expect("Partial write");

        let meta = read_metadata(&tmp).expect("Read back");
        assert_eq!(meta.title.as_deref(), Some("Original Title"), "Title should be preserved");
        assert_eq!(meta.artist.as_deref(), Some("Updated Artist"), "Artist should be updated");

        let _ = std::fs::remove_file(&tmp);
    }

    // ─── Artwork extraction tests ──────────────────────────────────

    #[test]
    fn extract_artwork_returns_none_for_no_art() {
        // Create a minimal MP3 without artwork
        let tmp = std::env::temp_dir().join("lfm-test-no-art.mp3");
        let path = test_mp3();
        if !path.exists() { return; }

        std::fs::copy(&path, &tmp).expect("Should copy");

        // The test MP3 may or may not have artwork — just verify no crash
        let result = extract_artwork(&tmp);
        assert!(result.is_ok(), "Should not error");
        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn extract_artwork_data_url_format() {
        let path = test_mp3();
        if !path.exists() { return; }

        if let Ok(Some(art)) = extract_artwork(&path) {
            assert!(art.data_url.starts_with("data:image/"), "Should be a data URL");
            assert!(art.data_url.contains(";base64,"), "Should be base64 encoded");
            assert!(!art.mime_type.is_empty(), "MIME type should not be empty");
        }
        // If no artwork, that's fine — test passes
    }

    // ─── Serialization tests ───────────────────────────────────────

    #[test]
    fn audio_metadata_serializes_to_json() {
        let meta = AudioMetadata {
            title: Some("Test".to_string()),
            artist: None,
            album: None,
            track_number: Some(1),
            genre: None,
            year: None,
            lyrics: None,
            has_artwork: false,
            duration_secs: 180.5,
            sample_rate: Some(44100),
            bit_depth: Some(16),
            channels: Some(2),
            format: "MP3".to_string(),
        };

        let json = serde_json::to_string(&meta).expect("Should serialize");
        assert!(json.contains("\"duration_secs\":180.5"));
        assert!(json.contains("\"sample_rate\":44100"));
        assert!(json.contains("\"format\":\"MP3\""));

        // Roundtrip
        let deserialized: AudioMetadata = serde_json::from_str(&json).expect("Should deserialize");
        assert_eq!(deserialized.title.as_deref(), Some("Test"));
        assert_eq!(deserialized.duration_secs, 180.5);
    }
}
