// Lightning FM — Welcome credits and funding state
// Tracks whether the listener has credits, a funded wallet, or neither.
// Determines playback mode: full stream vs preview-only.
// Persists to ~/.lightning-fm/credits.json so credits survive app restarts.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

const DEFAULT_WELCOME_CREDITS: u64 = 1000; // sats

/// On-disk representation of credits state
#[derive(Serialize, Deserialize)]
struct CreditsFile {
    credits_remaining: u64,
    credits_used: bool,
}

/// Returns the path to ~/.lightning-fm/credits.json
fn credits_file_path() -> PathBuf {
    let home = dirs::home_dir().expect("Could not determine home directory");
    home.join(".lightning-fm").join("credits.json")
}

/// Write credits state to disk. Takes raw values to avoid re-locking mutexes.
fn write_credits_file(remaining: u64, used: bool) -> Result<(), String> {
    let path = credits_file_path();

    // Ensure directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create credits dir: {e}"))?;
    }

    let file = CreditsFile {
        credits_remaining: remaining,
        credits_used: used,
    };

    let json = serde_json::to_string_pretty(&file)
        .map_err(|e| format!("Failed to serialize credits: {e}"))?;

    std::fs::write(&path, json)
        .map_err(|e| format!("Failed to write credits file: {e}"))?;

    Ok(())
}

/// Read credits state from disk. Returns None if file doesn't exist or is invalid.
fn read_credits_file() -> Option<CreditsFile> {
    let path = credits_file_path();
    let data = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

/// Funding state — determines what the listener can do
/// Funded variant used when Strike/NWC wallet is wired up (Phase 3)
#[derive(Serialize, Clone, Debug)]
#[allow(dead_code)]
pub enum FundingStatus {
    /// Has sats in wallet (Strike, NWC, or manual deposit)
    Funded { balance_sats: u64 },
    /// Using welcome credits (one-time, deplete naturally)
    Credits { remaining_sats: u64 },
    /// No funding — preview-only mode
    Unfunded,
}

/// Shared credits/funding state
pub struct CreditsState {
    pub credits_remaining: Mutex<u64>,
    pub credits_used: Mutex<bool>,
}

impl CreditsState {
    /// Load from disk if available, otherwise initialize with defaults and persist.
    pub fn new() -> Self {
        if let Some(file) = read_credits_file() {
            log::info!(
                "Loaded credits from disk: {} sats remaining, used={}",
                file.credits_remaining, file.credits_used,
            );
            Self {
                credits_remaining: Mutex::new(file.credits_remaining),
                credits_used: Mutex::new(file.credits_used),
            }
        } else {
            log::info!("No credits file found — initializing with {} sats welcome credits", DEFAULT_WELCOME_CREDITS);
            // Persist defaults so the file exists for next launch
            let _ = write_credits_file(DEFAULT_WELCOME_CREDITS, false);
            Self {
                credits_remaining: Mutex::new(DEFAULT_WELCOME_CREDITS),
                credits_used: Mutex::new(false),
            }
        }
    }
}

/// Save current state to disk. Acquires both locks — only call when neither is held.
fn save_to_disk(state: &CreditsState) -> Result<(), String> {
    let remaining = *state.credits_remaining.lock()
        .map_err(|e| format!("Failed to lock credits_remaining: {e}"))?;
    let used = *state.credits_used.lock()
        .map_err(|e| format!("Failed to lock credits_used: {e}"))?;
    write_credits_file(remaining, used)
}

/// Get current funding status (checks credits, will check wallet later)
pub fn get_funding_status(state: &CreditsState) -> Result<FundingStatus, String> {
    let remaining = *state.credits_remaining.lock()
        .map_err(|e| format!("Failed to lock credits_remaining: {e}"))?;
    let used = *state.credits_used.lock()
        .map_err(|e| format!("Failed to lock credits_used: {e}"))?;

    // TODO: Check LDK wallet balance when Strike/NWC is wired up
    // For now, credits are the only funding source

    if remaining > 0 {
        Ok(FundingStatus::Credits { remaining_sats: remaining })
    } else if used {
        // Credits were used and are now depleted
        Ok(FundingStatus::Unfunded)
    } else {
        // Fresh user — credits haven't been activated yet
        Ok(FundingStatus::Credits { remaining_sats: remaining })
    }
}

/// Activate welcome credits (called on first play)
pub fn activate_credits(state: &CreditsState) -> Result<(), String> {
    {
        let mut used = state.credits_used.lock()
            .map_err(|e| format!("Failed to lock credits_used: {e}"))?;
        *used = true;
    }
    save_to_disk(state)
}

/// Deduct from credits (returns true if deduction succeeded, false if insufficient)
pub fn deduct_credits(state: &CreditsState, amount_sats: u64) -> Result<bool, String> {
    let (success, remaining, used) = {
        let mut remaining = state.credits_remaining.lock()
            .map_err(|e| format!("Failed to lock credits_remaining: {e}"))?;
        if *remaining >= amount_sats {
            *remaining -= amount_sats;
            let used = *state.credits_used.lock()
                .map_err(|e| format!("Failed to lock credits_used: {e}"))?;
            (true, *remaining, used)
        } else {
            return Ok(false);
        }
    };

    if success {
        write_credits_file(remaining, used)?;
    }
    Ok(true)
}

/// Refund credits (rollback after a failed payment)
pub fn refund_credits(state: &CreditsState, amount_sats: u64) -> Result<(), String> {
    let (remaining, used) = {
        let mut rem = state.credits_remaining.lock()
            .map_err(|e| format!("Failed to lock credits_remaining: {e}"))?;
        *rem += amount_sats;
        let used = *state.credits_used.lock()
            .map_err(|e| format!("Failed to lock credits_used: {e}"))?;
        (*rem, used)
    };

    write_credits_file(remaining, used)
}

/// Add sats to the credits pool. Called when a Lightning payment is received,
/// so incoming sats flow into the same unified balance the streaming engine deducts from.
/// Semantically distinct from refund_credits (which rolls back a failed send).
pub fn add_credits(state: &CreditsState, amount_sats: u64) -> Result<(), String> {
    let (remaining, used) = {
        let mut rem = state.credits_remaining.lock()
            .map_err(|e| format!("Failed to lock credits_remaining: {e}"))?;
        *rem += amount_sats;
        let used = *state.credits_used.lock()
            .map_err(|e| format!("Failed to lock credits_used: {e}"))?;
        (*rem, used)
    };

    write_credits_file(remaining, used)
}

/// Check if user can stream full tracks (has credits or funded wallet)
pub fn can_stream(state: &CreditsState) -> Result<bool, String> {
    let remaining = *state.credits_remaining.lock()
        .map_err(|e| format!("Failed to lock credits_remaining: {e}"))?;
    // TODO: Also check LDK wallet balance
    Ok(remaining > 0)
}

/// Get credits info for display
#[derive(Serialize)]
pub struct CreditsInfo {
    pub remaining_sats: u64,
    pub total_granted: u64,
    pub is_active: bool,
    pub can_stream: bool,
}

pub fn get_credits_info(state: &CreditsState) -> Result<CreditsInfo, String> {
    let remaining = *state.credits_remaining.lock()
        .map_err(|e| format!("Failed to lock credits_remaining: {e}"))?;
    let used = *state.credits_used.lock()
        .map_err(|e| format!("Failed to lock credits_used: {e}"))?;

    Ok(CreditsInfo {
        remaining_sats: remaining,
        total_granted: DEFAULT_WELCOME_CREDITS,
        is_active: used,
        can_stream: remaining > 0,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Tests use CreditsState::new() which will read/write the real credits file.
    // For unit tests that shouldn't touch disk, we construct state directly.
    fn test_state() -> CreditsState {
        CreditsState {
            credits_remaining: Mutex::new(DEFAULT_WELCOME_CREDITS),
            credits_used: Mutex::new(false),
        }
    }

    #[test]
    fn new_state_has_default_credits() {
        let state = test_state();
        let remaining = *state.credits_remaining.lock().unwrap();
        assert_eq!(remaining, 1000, "New user should have 1000 sats of welcome credits");
    }

    #[test]
    fn new_user_can_stream() {
        let state = test_state();
        assert!(can_stream(&state).unwrap(), "New user with credits should be able to stream");
    }

    #[test]
    fn deduct_reduces_balance() {
        let state = test_state();
        let success = deduct_credits(&state, 100).unwrap();
        assert!(success, "Deduction should succeed");
        let remaining = *state.credits_remaining.lock().unwrap();
        assert_eq!(remaining, 900, "Should have 900 after deducting 100");
    }

    #[test]
    fn deduct_fails_when_insufficient() {
        let state = test_state();
        let success = deduct_credits(&state, 1001).unwrap();
        assert!(!success, "Should fail when deducting more than available");
        let remaining = *state.credits_remaining.lock().unwrap();
        assert_eq!(remaining, 1000, "Balance should be unchanged after failed deduction");
    }

    #[test]
    fn deduct_to_zero_then_cannot_stream() {
        let state = test_state();
        let success = deduct_credits(&state, 1000).unwrap();
        assert!(success, "Should be able to deduct full balance");
        assert!(!can_stream(&state).unwrap(), "Should not be able to stream with zero credits");
    }

    #[test]
    fn multiple_deductions_accumulate() {
        let state = test_state();
        deduct_credits(&state, 100).unwrap(); // 900
        deduct_credits(&state, 100).unwrap(); // 800
        deduct_credits(&state, 100).unwrap(); // 700
        let remaining = *state.credits_remaining.lock().unwrap();
        assert_eq!(remaining, 700, "Three deductions of 100 should leave 700");
    }

    #[test]
    fn activate_credits_sets_used_flag() {
        let state = test_state();
        let used_before = *state.credits_used.lock().unwrap();
        assert!(!used_before, "Credits should not be active before first play");

        activate_credits(&state).unwrap();
        let used_after = *state.credits_used.lock().unwrap();
        assert!(used_after, "Credits should be active after activation");
    }

    #[test]
    fn funding_status_reflects_credits() {
        let state = test_state();

        match get_funding_status(&state).unwrap() {
            FundingStatus::Credits { remaining_sats } => {
                assert_eq!(remaining_sats, 1000);
            }
            _ => panic!("New user should have Credits funding status"),
        }

        deduct_credits(&state, 1000).unwrap();
        activate_credits(&state).unwrap();

        match get_funding_status(&state).unwrap() {
            FundingStatus::Unfunded => {}
            _ => panic!("Depleted user should be Unfunded"),
        }
    }

    #[test]
    fn credits_info_is_accurate() {
        let state = test_state();
        activate_credits(&state).unwrap();
        deduct_credits(&state, 250).unwrap();

        let info = get_credits_info(&state).unwrap();
        assert_eq!(info.remaining_sats, 750);
        assert_eq!(info.total_granted, 1000);
        assert!(info.is_active);
        assert!(info.can_stream);
    }

    #[test]
    fn refund_credits_restores_balance() {
        let state = test_state();
        deduct_credits(&state, 300).unwrap();
        assert_eq!(*state.credits_remaining.lock().unwrap(), 700);

        refund_credits(&state, 300).unwrap();
        assert_eq!(*state.credits_remaining.lock().unwrap(), 1000);
    }

    #[test]
    fn add_credits_increases_balance() {
        let state = test_state();
        assert_eq!(*state.credits_remaining.lock().unwrap(), 1000);

        add_credits(&state, 5000).unwrap();
        assert_eq!(*state.credits_remaining.lock().unwrap(), 6000);
    }

    #[test]
    fn add_credits_works_when_balance_is_zero() {
        let state = test_state();
        deduct_credits(&state, 1000).unwrap();
        assert_eq!(*state.credits_remaining.lock().unwrap(), 0);

        add_credits(&state, 10_000).unwrap();
        assert_eq!(*state.credits_remaining.lock().unwrap(), 10_000);
    }

    #[test]
    fn add_credits_does_not_flip_used_flag() {
        let state = test_state();
        let used_before = *state.credits_used.lock().unwrap();
        assert!(!used_before);

        add_credits(&state, 500).unwrap();
        let used_after = *state.credits_used.lock().unwrap();
        assert!(!used_after, "add_credits should not touch the used flag");
    }

    #[test]
    fn credits_file_round_trips() {
        let file = CreditsFile {
            credits_remaining: 750,
            credits_used: true,
        };
        let json = serde_json::to_string(&file).unwrap();
        let parsed: CreditsFile = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.credits_remaining, 750);
        assert!(parsed.credits_used);
    }
}
