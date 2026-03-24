// Lightning FM — Waveform peak generation
// Decodes audio to PCM via symphonia, computes amplitude peaks, caches to disk.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// Default number of peaks to generate (enough for ~600px wide waveform)
const DEFAULT_PEAK_COUNT: usize = 200;

/// Waveform peak data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaveformData {
    /// Normalized peaks (0.0 to 1.0)
    pub peaks: Vec<f32>,
    /// Duration in seconds
    pub duration_secs: f64,
}

/// Generate waveform peaks from an audio file.
/// Returns cached result if available, otherwise decodes and caches.
pub fn generate_peaks(path: &Path, peak_count: Option<usize>) -> Result<WaveformData, String> {
    let count = peak_count.unwrap_or(DEFAULT_PEAK_COUNT);

    // Check cache first
    if let Some(cached) = read_cache(path) {
        if cached.peaks.len() == count {
            return Ok(cached);
        }
    }

    // Decode and compute peaks
    let data = compute_peaks(path, count)?;

    // Cache for next time (fire-and-forget, don't fail if cache write fails)
    let _ = write_cache(path, &data);

    Ok(data)
}

fn compute_peaks(path: &Path, peak_count: usize) -> Result<WaveformData, String> {
    let file = std::fs::File::open(path)
        .map_err(|e| format!("Failed to open audio file: {}", e))?;

    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    // Probe the format
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| format!("Failed to probe audio format: {}", e))?;

    let mut format = probed.format;

    // Find the first audio track
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .ok_or("No audio track found")?;

    let track_id = track.id;

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("Failed to create decoder: {}", e))?;

    // First pass: collect all samples to compute total count
    // For large files this uses memory, but desktop apps have plenty.
    // A streaming two-pass approach could optimize this later.
    let mut all_samples: Vec<f32> = Vec::new();
    let mut duration_secs: f64 = 0.0;
    let mut sample_rate: u32 = 44100;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(_) => break,
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(_) => continue,
        };

        let spec = *decoded.spec();
        sample_rate = spec.rate;

        let mut sample_buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
        sample_buf.copy_interleaved_ref(decoded);
        let samples = sample_buf.samples();

        // If stereo, take max of channels per sample position
        let channels = spec.channels.count();
        if channels > 1 {
            for chunk in samples.chunks(channels) {
                let max_abs = chunk.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
                all_samples.push(max_abs);
            }
        } else {
            all_samples.extend(samples.iter().map(|s| s.abs()));
        }
    }

    if !all_samples.is_empty() {
        duration_secs = all_samples.len() as f64 / sample_rate as f64;
    }

    // Compute peaks by bucketing samples
    let samples_per_peak = if all_samples.is_empty() {
        1
    } else {
        (all_samples.len() / peak_count).max(1)
    };

    let mut peaks = Vec::with_capacity(peak_count);
    for i in 0..peak_count {
        let start = i * samples_per_peak;
        let end = ((i + 1) * samples_per_peak).min(all_samples.len());
        if start >= all_samples.len() {
            peaks.push(0.0);
        } else {
            let max = all_samples[start..end]
                .iter()
                .fold(0.0f32, |a, &b| a.max(b));
            peaks.push(max);
        }
    }

    // Normalize to 0.0-1.0
    let global_max = peaks.iter().fold(0.0f32, |a, &b| a.max(b));
    if global_max > 0.0 {
        for p in &mut peaks {
            *p /= global_max;
        }
    }

    Ok(WaveformData {
        peaks,
        duration_secs,
    })
}

/// Cache directory: ~/.lightning-fm/waveforms/
fn cache_path(audio_path: &Path) -> Option<PathBuf> {
    let cache_dir = dirs::home_dir()?.join(".lightning-fm").join("waveforms");
    // Use the file's SHA-256 hash as the cache key would be ideal,
    // but we don't have it here. Use filename + size as a quick key.
    let size = std::fs::metadata(audio_path).ok()?.len();
    let name = audio_path.file_name()?.to_str()?;
    let key = format!("{}-{}", name, size);
    // Simple hash of the key for the filename
    use sha2::{Sha256, Digest};
    let hash = format!("{:x}", Sha256::digest(key.as_bytes()));
    Some(cache_dir.join(format!("{}.json", &hash[..16])))
}

fn read_cache(audio_path: &Path) -> Option<WaveformData> {
    let path = cache_path(audio_path)?;
    let data = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

fn write_cache(audio_path: &Path, data: &WaveformData) -> Option<()> {
    let path = cache_path(audio_path)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok()?;
    }
    let json = serde_json::to_string(data).ok()?;
    std::fs::write(&path, json).ok()?;
    log::info!("Cached waveform to {}", path.display());
    Some(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn test_data_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("test-data")
    }

    fn test_wav() -> PathBuf {
        test_data_dir().join("test-tone.wav")
    }

    // ─── Peak computation tests ────────────────────────────────────
    // Uses test-tone.wav (172KB, 1s, 440Hz sine) — decodes instantly in debug mode.

    #[test]
    fn generate_peaks_returns_correct_count() {
        let path = test_wav();
        if !path.exists() { return; }

        let data = generate_peaks(&path, Some(100)).expect("Should generate peaks");
        assert_eq!(data.peaks.len(), 100, "Should return requested peak count");
    }

    #[test]
    fn generate_peaks_default_count() {
        let path = test_wav();
        if !path.exists() { return; }

        let data = generate_peaks(&path, None).expect("Should generate peaks");
        assert_eq!(data.peaks.len(), DEFAULT_PEAK_COUNT);
    }

    #[test]
    fn peaks_are_normalized_zero_to_one() {
        let path = test_wav();
        if !path.exists() { return; }

        let data = generate_peaks(&path, Some(50)).expect("Should generate peaks");
        for (i, &p) in data.peaks.iter().enumerate() {
            assert!(p >= 0.0, "Peak {} should be >= 0, got {}", i, p);
            assert!(p <= 1.0, "Peak {} should be <= 1, got {}", i, p);
        }
    }

    #[test]
    fn peaks_have_at_least_one_max() {
        let path = test_wav();
        if !path.exists() { return; }

        let data = generate_peaks(&path, Some(50)).expect("Should generate peaks");
        let max = data.peaks.iter().fold(0.0f32, |a, &b| a.max(b));
        // After normalization, at least one peak should be 1.0 (or very close)
        assert!(max > 0.99, "Normalized peaks should have max near 1.0, got {}", max);
    }

    #[test]
    fn duration_is_positive() {
        let path = test_wav();
        if !path.exists() { return; }

        let data = generate_peaks(&path, Some(50)).expect("Should generate peaks");
        assert!(data.duration_secs > 0.0, "Duration should be positive");
    }

    #[test]
    fn duration_is_approximately_one_second() {
        let path = test_wav();
        if !path.exists() { return; }

        let data = generate_peaks(&path, Some(50)).expect("Should generate peaks");
        assert!((data.duration_secs - 1.0).abs() < 0.1,
            "Test tone should be ~1s, got {}", data.duration_secs);
    }

    #[test]
    fn peaks_are_not_all_zero() {
        let path = test_wav();
        if !path.exists() { return; }

        let data = generate_peaks(&path, Some(50)).expect("Should generate peaks");
        let sum: f32 = data.peaks.iter().sum();
        assert!(sum > 0.0, "Peaks should not all be zero — this is audio");
    }

    #[test]
    fn nonexistent_file_returns_error() {
        let result = generate_peaks(Path::new("/tmp/nope.mp3"), None);
        assert!(result.is_err());
    }

    // ─── Cache tests ───────────────────────────────────────────────

    #[test]
    fn cache_path_is_deterministic() {
        let p = Path::new("/some/path/song.mp3");
        let c1 = cache_path(p);
        let c2 = cache_path(p);
        // Both should return the same path (or both None if no home dir)
        assert_eq!(c1, c2, "Cache path should be deterministic");
    }

    #[test]
    fn second_call_uses_cache() {
        let path = test_wav();
        if !path.exists() { return; }

        // First call computes and caches
        let data1 = generate_peaks(&path, Some(50)).expect("First call");

        // Second call should return same data (from cache)
        let data2 = generate_peaks(&path, Some(50)).expect("Second call");

        assert_eq!(data1.peaks.len(), data2.peaks.len());
        assert!((data1.duration_secs - data2.duration_secs).abs() < 0.01);
    }

    // ─── Serialization tests ───────────────────────────────────────

    #[test]
    fn waveform_data_roundtrips_json() {
        let data = WaveformData {
            peaks: vec![0.0, 0.5, 1.0, 0.75, 0.25],
            duration_secs: 240.5,
        };

        let json = serde_json::to_string(&data).expect("Should serialize");
        let restored: WaveformData = serde_json::from_str(&json).expect("Should deserialize");

        assert_eq!(restored.peaks.len(), 5);
        assert_eq!(restored.peaks[2], 1.0);
        assert_eq!(restored.duration_secs, 240.5);
    }
}
