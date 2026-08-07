// Lightning FM — Streaming payment engine
// Manages the keysend payment loop: 100 sats/min, all of it to the artist.
// All decision logic is pure and testable. LDK calls are isolated.

use ldk_node::bitcoin::secp256k1::PublicKey;
use serde::Serialize;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Payment interval in seconds
pub const INTERVAL_SECS: u64 = 60;

/// Base rate per interval
pub const SATS_PER_INTERVAL: u64 = 100;

/// TLV type for Lightning FM custom records in keysend.
/// All types must be ODD per BOLT 1 ("it's OK to be odd" — even types are rejected
/// by nodes that don't understand them).
pub const TLV_TRACK_ID: u64 = 696969;
pub const TLV_LISTENER_PUBKEY: u64 = 696971;
pub const TLV_TIMESTAMP: u64 = 696973;

// ─── Payment amount ──────────────────────────────────────────

/// Sats paid to the artist per interval. There is no platform cut — whether
/// we serve the bytes from a mirror or the artist serves them directly, the
/// listener's payment goes to the artist in full. See
/// decision:lfm_pricing_no_rake_flat_convenience.
pub fn artist_sats_per_interval() -> u64 {
    SATS_PER_INTERVAL
}

/// Total sats the listener pays per interval.
pub fn listener_cost_per_interval() -> u64 {
    SATS_PER_INTERVAL
}

// ─── TLV Records ─────────────────────────────────────────────

/// Build custom TLV records for a keysend payment.
/// These are embedded in the onion payload so the artist knows what the payment is for.
#[derive(Debug, Clone, Serialize)]
pub struct PaymentTlvRecords {
    pub track_id: String,
    pub listener_pubkey: String,
    pub timestamp: u64,
}

pub fn build_tlv_records(track_id: &str, listener_pubkey: &str) -> PaymentTlvRecords {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    PaymentTlvRecords {
        track_id: track_id.to_string(),
        listener_pubkey: listener_pubkey.to_string(),
        timestamp,
    }
}

// ─── Custom TLV Record Construction ─────────────────────────

use ldk_node::CustomTlvRecord;

/// Build custom TLV records for a keysend payment.
/// These are embedded in the onion payload so the artist knows what the payment is for.
pub fn build_custom_tlv_vec(track_id: &str, listener_pubkey: &str) -> Vec<CustomTlvRecord> {
    let records = build_tlv_records(track_id, listener_pubkey);
    vec![
        CustomTlvRecord { type_num: TLV_TRACK_ID, value: records.track_id.into_bytes() },
        CustomTlvRecord { type_num: TLV_LISTENER_PUBKEY, value: records.listener_pubkey.into_bytes() },
        CustomTlvRecord { type_num: TLV_TIMESTAMP, value: records.timestamp.to_be_bytes().to_vec() },
    ]
}

// ─── Lightning Pubkey Parsing ────────────────────────────────

/// Parse a Lightning node_id from hex string.
/// Lightning node_ids are 33-byte compressed secp256k1 public keys (66 hex chars).
/// This is distinct from Nostr pubkeys which are 32-byte x-only keys (64 hex chars).
pub fn parse_lightning_pubkey(hex: &str) -> Result<PublicKey, String> {
    hex.parse::<PublicKey>()
        .map_err(|e| format!("Invalid Lightning node_id '{}': {}", hex, e))
}

// ─── Stream Session ──────────────────────────────────────────

/// Tracks the state of an active streaming session
#[derive(Debug, Clone, Serialize)]
pub struct StreamSession {
    pub track_id: String,
    pub artist_pubkey: String,
    /// Lightning node_id for keysend payments (33-byte compressed, hex).
    /// None if the artist hasn't published their node_id — payments are skipped.
    pub lightning_node_id: Option<String>,
    pub artist_direct: bool,
    pub is_playing: bool,
    pub intervals_paid: u64,
    pub total_artist_sats: u64,
    pub total_listener_sats: u64,
    pub started_at: u64,
}

impl StreamSession {
    pub fn new(track_id: &str, artist_pubkey: &str, lightning_node_id: Option<&str>, artist_direct: bool) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        Self {
            track_id: track_id.to_string(),
            artist_pubkey: artist_pubkey.to_string(),
            lightning_node_id: lightning_node_id.map(|s| s.to_string()),
            artist_direct,
            is_playing: true,
            intervals_paid: 0,
            total_artist_sats: 0,
            total_listener_sats: 0,
            started_at: now,
        }
    }

    /// Record a successful payment interval
    pub fn record_payment(&mut self) {
        self.intervals_paid += 1;
        self.total_artist_sats += artist_sats_per_interval();
        self.total_listener_sats += listener_cost_per_interval();
    }

    /// Pause the session (stop payments but keep state)
    pub fn pause(&mut self) {
        self.is_playing = false;
    }

    /// Resume the session
    pub fn resume(&mut self) {
        self.is_playing = true;
    }

    /// Check if a payment is due (based on intervals paid vs elapsed time)
    pub fn is_payment_due(&self, elapsed_secs: u64) -> bool {
        if !self.is_playing {
            return false;
        }
        let expected_intervals = elapsed_secs / INTERVAL_SECS;
        expected_intervals > self.intervals_paid
    }

    /// Estimated minutes streamed
    pub fn minutes_streamed(&self) -> f64 {
        self.intervals_paid as f64
    }
}

/// Shared streaming state
pub struct StreamingState {
    pub session: Mutex<Option<StreamSession>>,
}

impl StreamingState {
    pub fn new() -> Self {
        Self {
            session: Mutex::new(None),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ─── Payment amount tests ────────────────────────────────

    #[test]
    fn artist_receives_the_whole_interval() {
        assert_eq!(artist_sats_per_interval(), 100, "Artist gets all 100 sats");
    }

    #[test]
    fn listener_payment_reaches_the_artist_intact() {
        // No rake, ever — what the listener pays is what the artist receives,
        // regardless of who served the bytes.
        assert_eq!(artist_sats_per_interval(), listener_cost_per_interval());
    }

    #[test]
    fn session_accrues_full_payment_for_mirror_served_tracks() {
        let mut session = StreamSession::new("track-abc", "npub1xyz", None, false);
        session.record_payment();
        assert_eq!(session.total_artist_sats, 100);
        assert_eq!(session.total_listener_sats, 100);
    }

    #[test]
    fn listener_cost_is_constant() {
        assert_eq!(listener_cost_per_interval(), 100);
    }

    // ─── TLV record tests ────────────────────────────────────

    #[test]
    fn tlv_records_contain_correct_data() {
        let records = build_tlv_records("track-abc", "npub1xyz");
        assert_eq!(records.track_id, "track-abc");
        assert_eq!(records.listener_pubkey, "npub1xyz");
        assert!(records.timestamp > 0, "Timestamp should be set");
    }

    #[test]
    fn tlv_timestamps_are_recent() {
        let records = build_tlv_records("test", "test");
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        assert!(records.timestamp <= now);
        assert!(records.timestamp > now - 5, "Timestamp should be within last 5 seconds");
    }

    // ─── Stream session tests ────────────────────────────────

    #[test]
    fn new_session_starts_playing() {
        let session = StreamSession::new("track-1", "artist-pub", None, true);
        assert!(session.is_playing);
        assert_eq!(session.intervals_paid, 0);
        assert_eq!(session.total_listener_sats, 0);
    }

    #[test]
    fn record_payment_direct_accumulates_correctly() {
        let mut session = StreamSession::new("track-1", "artist-pub", None, true);
        session.record_payment();
        session.record_payment();
        session.record_payment();

        assert_eq!(session.intervals_paid, 3);
        assert_eq!(session.total_artist_sats, 300, "Artist gets 100 per interval (direct)");
        assert_eq!(session.total_listener_sats, 300, "Listener pays 100 per interval");
    }

    #[test]
    fn record_payment_mirror_accumulates_without_rake() {
        let mut session = StreamSession::new("track-1", "artist-pub", None, false);
        session.record_payment();
        session.record_payment();

        assert_eq!(session.intervals_paid, 2);
        assert_eq!(session.total_artist_sats, 200, "Artist gets 100 per interval from mirror too");
        assert_eq!(session.total_listener_sats, 200, "Listener pays 100 per interval");
    }

    #[test]
    fn pause_stops_payment_due() {
        let mut session = StreamSession::new("track-1", "artist-pub", None, true);

        assert!(session.is_payment_due(61), "Should be due after 61 seconds");

        session.pause();
        assert!(!session.is_payment_due(61), "Should NOT be due when paused");

        session.resume();
        assert!(session.is_payment_due(61), "Should be due again after resume");
    }

    #[test]
    fn payment_due_respects_intervals_paid() {
        let mut session = StreamSession::new("track-1", "artist-pub", None, true);

        // At 0 intervals paid, payment is due at 60s
        assert!(!session.is_payment_due(59), "Not due at 59s");
        assert!(session.is_payment_due(60), "Due at 60s");

        session.record_payment(); // now 1 interval paid

        assert!(!session.is_payment_due(60), "Not due at 60s (already paid)");
        assert!(!session.is_payment_due(119), "Not due at 119s");
        assert!(session.is_payment_due(120), "Due at 120s (second interval)");
    }

    #[test]
    fn minutes_streamed_tracks_intervals() {
        let mut session = StreamSession::new("track-1", "artist-pub", None, true);
        assert_eq!(session.minutes_streamed(), 0.0);

        session.record_payment();
        assert_eq!(session.minutes_streamed(), 1.0);

        session.record_payment();
        session.record_payment();
        assert_eq!(session.minutes_streamed(), 3.0);
    }

    #[test]
    fn mixed_session_scenario() {
        // Simulate: artist-direct track, 5 minutes played with a pause in the middle
        let mut session = StreamSession::new("midnight-train", "npub1artist", None, true);

        // Play for 2 minutes
        session.record_payment(); // minute 1
        session.record_payment(); // minute 2

        // Pause
        session.pause();
        assert!(!session.is_payment_due(180)); // 3 minutes elapsed but paused

        // Resume
        session.resume();

        // Play 3 more minutes
        session.record_payment(); // minute 3
        session.record_payment(); // minute 4
        session.record_payment(); // minute 5

        assert_eq!(session.intervals_paid, 5);
        assert_eq!(session.total_artist_sats, 500);
        assert_eq!(session.total_listener_sats, 500);
        assert_eq!(session.minutes_streamed(), 5.0);
    }

    // ─── Lightning pubkey parsing tests ──────────────────────

    #[test]
    fn parse_valid_lightning_pubkey() {
        // Valid 33-byte compressed pubkey (02 prefix + 32 bytes)
        let valid = "0371d6fd7d75de2d0372d03ea00e8bacdacb50c27d0eaea0a76a0622eff1f5ef2b";
        let result = parse_lightning_pubkey(valid);
        assert!(result.is_ok(), "Should parse valid compressed pubkey");
        assert_eq!(result.unwrap().to_string(), valid);
    }

    #[test]
    fn parse_invalid_lightning_pubkey() {
        assert!(parse_lightning_pubkey("not-a-key").is_err());
        assert!(parse_lightning_pubkey("").is_err());
        assert!(parse_lightning_pubkey("02abcd").is_err()); // too short
    }

    #[test]
    fn parse_nostr_xonly_pubkey_fails() {
        // 32-byte x-only key (64 hex chars) — this is a Nostr pubkey, not a Lightning node_id
        let nostr_key = "7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e";
        let result = parse_lightning_pubkey(nostr_key);
        assert!(result.is_err(), "Nostr x-only pubkey should not parse as Lightning node_id");
    }

    #[test]
    fn session_with_lightning_node_id() {
        let session = StreamSession::new(
            "track-1",
            "nostr-pubkey-hex",
            Some("0371d6fd7d75de2d0372d03ea00e8bacdacb50c27d0eaea0a76a0622eff1f5ef2b"),
            true,
        );
        assert_eq!(
            session.lightning_node_id,
            Some("0371d6fd7d75de2d0372d03ea00e8bacdacb50c27d0eaea0a76a0622eff1f5ef2b".to_string())
        );
    }

    #[test]
    fn session_without_lightning_node_id() {
        let session = StreamSession::new("track-1", "nostr-pubkey-hex", None, true);
        assert!(session.lightning_node_id.is_none());
    }

    #[test]
    fn sats_to_msats_conversion() {
        // Document the contract: keysend uses msats, we track sats
        let artist_sats: u64 = 100;
        let amount_msat = artist_sats * 1000;
        assert_eq!(amount_msat, 100_000);

        let artist_sats_mirror: u64 = 90;
        let amount_msat_mirror = artist_sats_mirror * 1000;
        assert_eq!(amount_msat_mirror, 90_000);
    }
}
