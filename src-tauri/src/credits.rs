// Lightning FM — Welcome credits and funding state
// Tracks whether the listener has credits, a funded wallet, or neither.
// Determines playback mode: full stream vs preview-only.

use serde::Serialize;
use std::sync::Mutex;

const DEFAULT_WELCOME_CREDITS: u64 = 1000; // sats

/// Funding state — determines what the listener can do
#[derive(Serialize, Clone, Debug)]
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
    pub fn new() -> Self {
        Self {
            credits_remaining: Mutex::new(DEFAULT_WELCOME_CREDITS),
            credits_used: Mutex::new(false),
        }
    }
}

/// Get current funding status (checks credits, will check wallet later)
pub fn get_funding_status(state: &CreditsState) -> FundingStatus {
    let remaining = *state.credits_remaining.lock().unwrap();
    let used = *state.credits_used.lock().unwrap();

    // TODO: Check LDK wallet balance when Strike/NWC is wired up
    // For now, credits are the only funding source

    if remaining > 0 {
        FundingStatus::Credits { remaining_sats: remaining }
    } else if used {
        // Credits were used and are now depleted
        FundingStatus::Unfunded
    } else {
        // Fresh user — credits haven't been activated yet
        FundingStatus::Credits { remaining_sats: remaining }
    }
}

/// Activate welcome credits (called on first play)
pub fn activate_credits(state: &CreditsState) {
    let mut used = state.credits_used.lock().unwrap();
    *used = true;
}

/// Deduct from credits (returns true if deduction succeeded, false if insufficient)
pub fn deduct_credits(state: &CreditsState, amount_sats: u64) -> bool {
    let mut remaining = state.credits_remaining.lock().unwrap();
    if *remaining >= amount_sats {
        *remaining -= amount_sats;
        true
    } else {
        false
    }
}

/// Check if user can stream full tracks (has credits or funded wallet)
pub fn can_stream(state: &CreditsState) -> bool {
    let remaining = *state.credits_remaining.lock().unwrap();
    // TODO: Also check LDK wallet balance
    remaining > 0
}

/// Get credits info for display
#[derive(Serialize)]
pub struct CreditsInfo {
    pub remaining_sats: u64,
    pub total_granted: u64,
    pub is_active: bool,
    pub can_stream: bool,
}

pub fn get_credits_info(state: &CreditsState) -> CreditsInfo {
    let remaining = *state.credits_remaining.lock().unwrap();
    let used = *state.credits_used.lock().unwrap();

    CreditsInfo {
        remaining_sats: remaining,
        total_granted: DEFAULT_WELCOME_CREDITS,
        is_active: used,
        can_stream: remaining > 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_state_has_default_credits() {
        let state = CreditsState::new();
        let remaining = *state.credits_remaining.lock().unwrap();
        assert_eq!(remaining, 1000, "New user should have 1000 sats of welcome credits");
    }

    #[test]
    fn new_user_can_stream() {
        let state = CreditsState::new();
        assert!(can_stream(&state), "New user with credits should be able to stream");
    }

    #[test]
    fn deduct_reduces_balance() {
        let state = CreditsState::new();
        let success = deduct_credits(&state, 100);
        assert!(success, "Deduction should succeed");
        let remaining = *state.credits_remaining.lock().unwrap();
        assert_eq!(remaining, 900, "Should have 900 after deducting 100");
    }

    #[test]
    fn deduct_fails_when_insufficient() {
        let state = CreditsState::new();
        let success = deduct_credits(&state, 1001);
        assert!(!success, "Should fail when deducting more than available");
        let remaining = *state.credits_remaining.lock().unwrap();
        assert_eq!(remaining, 1000, "Balance should be unchanged after failed deduction");
    }

    #[test]
    fn deduct_to_zero_then_cannot_stream() {
        let state = CreditsState::new();
        let success = deduct_credits(&state, 1000);
        assert!(success, "Should be able to deduct full balance");
        assert!(!can_stream(&state), "Should not be able to stream with zero credits");
    }

    #[test]
    fn multiple_deductions_accumulate() {
        let state = CreditsState::new();
        deduct_credits(&state, 100); // 900
        deduct_credits(&state, 100); // 800
        deduct_credits(&state, 100); // 700
        let remaining = *state.credits_remaining.lock().unwrap();
        assert_eq!(remaining, 700, "Three deductions of 100 should leave 700");
    }

    #[test]
    fn activate_credits_sets_used_flag() {
        let state = CreditsState::new();
        let used_before = *state.credits_used.lock().unwrap();
        assert!(!used_before, "Credits should not be active before first play");

        activate_credits(&state);
        let used_after = *state.credits_used.lock().unwrap();
        assert!(used_after, "Credits should be active after activation");
    }

    #[test]
    fn funding_status_reflects_credits() {
        let state = CreditsState::new();

        match get_funding_status(&state) {
            FundingStatus::Credits { remaining_sats } => {
                assert_eq!(remaining_sats, 1000);
            }
            _ => panic!("New user should have Credits funding status"),
        }

        deduct_credits(&state, 1000);
        activate_credits(&state);

        match get_funding_status(&state) {
            FundingStatus::Unfunded => {}
            _ => panic!("Depleted user should be Unfunded"),
        }
    }

    #[test]
    fn credits_info_is_accurate() {
        let state = CreditsState::new();
        activate_credits(&state);
        deduct_credits(&state, 250);

        let info = get_credits_info(&state);
        assert_eq!(info.remaining_sats, 750);
        assert_eq!(info.total_granted, 1000);
        assert!(info.is_active);
        assert!(info.can_stream);
    }
}
