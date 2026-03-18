// Lightning FM — Nostr identity management
// Handles keypair generation, OS keychain storage, and identity retrieval.
// Lightning and Nostr keys are SEPARATE — this module only manages Nostr keys.

use nostr::prelude::*;
use keyring::Entry;
use serde::Serialize;
use std::sync::Mutex;

const KEYRING_SERVICE: &str = "fm.lightning.desktop";
const KEYRING_NSEC: &str = "nostr-nsec";

/// Shared identity state — holds the active keypair in memory
pub struct IdentityState {
    pub keys: Mutex<Option<Keys>>,
}

impl IdentityState {
    pub fn new() -> Self {
        Self {
            keys: Mutex::new(None),
        }
    }
}

/// Identity info returned to the frontend
#[derive(Serialize)]
pub struct IdentityInfo {
    pub npub: String,
    pub pubkey_hex: String,
    pub has_nsec: bool,
    pub display_name: Option<String>,
}

/// Generate a new Nostr keypair and store the nsec in OS keychain.
/// This is the "new user" path — they've never used Nostr before.
pub fn create_identity() -> Result<(Keys, IdentityInfo), String> {
    let keys = Keys::generate();

    // Store nsec in OS keychain
    store_nsec_in_keychain(&keys)?;

    let info = identity_info_from_keys(&keys, None);
    Ok((keys, info))
}

/// Load an existing identity from the OS keychain.
/// Called on app launch to check if a returning user has a stored identity.
pub fn load_identity_from_keychain() -> Result<Option<(Keys, IdentityInfo)>, String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_NSEC)
        .map_err(|e| format!("Keyring access error: {}", e))?;

    match entry.get_password() {
        Ok(nsec_str) => {
            let secret_key = SecretKey::parse(&nsec_str)
                .map_err(|e| format!("Invalid stored nsec: {}", e))?;
            let keys = Keys::new(secret_key);
            let info = identity_info_from_keys(&keys, None);
            Ok(Some((keys, info)))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Keyring read error: {}", e)),
    }
}

/// Import an existing nsec (for users who have a Nostr identity elsewhere).
/// Validates the key, stores it in keychain, returns the identity.
pub fn import_nsec(nsec_or_hex: &str) -> Result<(Keys, IdentityInfo), String> {
    // Try parsing as bech32 nsec first, then as hex
    let secret_key = if nsec_or_hex.starts_with("nsec1") {
        SecretKey::from_bech32(nsec_or_hex)
            .map_err(|e| format!("Invalid nsec: {}", e))?
    } else {
        SecretKey::parse(nsec_or_hex)
            .map_err(|e| format!("Invalid secret key: {}", e))?
    };

    let keys = Keys::new(secret_key);
    store_nsec_in_keychain(&keys)?;

    let info = identity_info_from_keys(&keys, None);
    Ok((keys, info))
}

/// Export the nsec as bech32 string (for backup).
/// Only works if there's an active identity with a stored nsec.
pub fn export_nsec(keys: &Keys) -> Result<String, String> {
    keys.secret_key().to_bech32().map_err(|e| format!("Failed to encode nsec: {}", e))
}

/// Remove the stored identity from the keychain.
pub fn delete_identity() -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_NSEC)
        .map_err(|e| format!("Keyring access error: {}", e))?;

    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // already gone
        Err(e) => Err(format!("Keyring delete error: {}", e)),
    }
}

// ─── Internal helpers ───────────────────────────────────────

fn store_nsec_in_keychain(keys: &Keys) -> Result<(), String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_NSEC)
        .map_err(|e| format!("Keyring access error: {}", e))?;

    // Store as hex (more compact, easier to parse back)
    let secret_hex = keys.secret_key().to_secret_hex();
    entry.set_password(&secret_hex)
        .map_err(|e| format!("Failed to store nsec in keychain: {}", e))?;

    Ok(())
}

fn identity_info_from_keys(keys: &Keys, display_name: Option<String>) -> IdentityInfo {
    IdentityInfo {
        npub: keys.public_key().to_bech32().unwrap_or_default(),
        pubkey_hex: keys.public_key().to_hex(),
        has_nsec: true,
        display_name,
    }
}
