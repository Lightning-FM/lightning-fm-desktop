// Lightning FM — Nostr identity management
// Handles keypair generation, OS keychain storage, and identity retrieval.
// Lightning and Nostr keys are SEPARATE — this module only manages Nostr keys.

use nostr_sdk::prelude::*;
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
    create_identity_with_name(None)
}

/// Generate a new Nostr keypair with an optional display name.
/// The display name is included in the returned IdentityInfo so the frontend
/// can use it immediately and publish it to relays once connected.
pub fn create_identity_with_name(display_name: Option<String>) -> Result<(Keys, IdentityInfo), String> {
    let keys = Keys::generate();

    // Store nsec in OS keychain
    store_nsec_in_keychain(&keys)?;

    let info = identity_info_from_keys(&keys, display_name);
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

#[cfg(test)]
mod tests {
    use super::*;

    // ─── Pure key operation tests ────────────────────────────

    #[test]
    fn generate_keypair_produces_valid_identity() {
        let keys = Keys::generate();
        let info = identity_info_from_keys(&keys, None);

        assert!(info.npub.starts_with("npub1"), "npub should start with npub1");
        assert_eq!(info.pubkey_hex.len(), 64, "pubkey hex should be 64 chars");
        assert!(info.has_nsec);
        assert!(info.display_name.is_none());
    }

    #[test]
    fn generate_keypair_is_unique() {
        let keys1 = Keys::generate();
        let keys2 = Keys::generate();
        assert_ne!(
            keys1.public_key().to_hex(),
            keys2.public_key().to_hex(),
            "Two generated keypairs should not be identical"
        );
    }

    #[test]
    fn import_nsec_bech32_roundtrips() {
        // Generate a key, export as bech32, reimport — should get same pubkey
        let original = Keys::generate();
        let nsec = original.secret_key().to_bech32().unwrap();
        assert!(nsec.starts_with("nsec1"));

        let secret_key = SecretKey::from_bech32(&nsec).unwrap();
        let reimported = Keys::new(secret_key);

        assert_eq!(
            original.public_key().to_hex(),
            reimported.public_key().to_hex(),
            "Reimported key should produce same pubkey"
        );
    }

    #[test]
    fn import_nsec_hex_roundtrips() {
        // Generate a key, export as hex, reimport — should get same pubkey
        let original = Keys::generate();
        let hex = original.secret_key().to_secret_hex();
        assert_eq!(hex.len(), 64);

        let secret_key = SecretKey::parse(&hex).unwrap();
        let reimported = Keys::new(secret_key);

        assert_eq!(
            original.public_key().to_hex(),
            reimported.public_key().to_hex(),
            "Reimported hex key should produce same pubkey"
        );
    }

    #[test]
    fn import_detects_bech32_vs_hex() {
        let keys = Keys::generate();

        // bech32 path
        let nsec = keys.secret_key().to_bech32().unwrap();
        assert!(nsec.starts_with("nsec1"), "bech32 nsec should be detected");

        // hex path
        let hex = keys.secret_key().to_secret_hex();
        assert!(!hex.starts_with("nsec1"), "hex should not be detected as bech32");
    }

    #[test]
    fn import_rejects_invalid_nsec() {
        let result = SecretKey::from_bech32("nsec1invalidgarbage");
        assert!(result.is_err(), "Invalid bech32 should fail");
    }

    #[test]
    fn import_rejects_invalid_hex() {
        let result = SecretKey::parse("not_a_valid_hex_key");
        assert!(result.is_err(), "Invalid hex should fail");
    }

    #[test]
    fn identity_info_includes_display_name_when_set() {
        let keys = Keys::generate();
        let info = identity_info_from_keys(&keys, Some("Alice".to_string()));
        assert_eq!(info.display_name, Some("Alice".to_string()));
    }

    #[test]
    fn export_nsec_produces_bech32() {
        let keys = Keys::generate();
        let exported = export_nsec(&keys).unwrap();
        assert!(exported.starts_with("nsec1"), "Exported nsec should be bech32");

        // Verify it reimports to the same key
        let secret_key = SecretKey::from_bech32(&exported).unwrap();
        let reimported = Keys::new(secret_key);
        assert_eq!(keys.public_key().to_hex(), reimported.public_key().to_hex());
    }

    // ─── Keychain logic tests (mocked) ─────────────────────────
    // Tests the store/load/delete logic using an in-memory HashMap
    // instead of the real macOS Keychain. We trust Apple's keychain works;
    // we're testing our parsing, roundtripping, and error handling.

    use std::collections::HashMap;
    use std::sync::Mutex as StdMutex;

    struct MockKeychain {
        store: StdMutex<HashMap<String, String>>,
    }

    impl MockKeychain {
        fn new() -> Self {
            Self { store: StdMutex::new(HashMap::new()) }
        }

        fn set_password(&self, service: &str, entry: &str, value: &str) {
            let key = format!("{}:{}", service, entry);
            self.store.lock().unwrap().insert(key, value.to_string());
        }

        fn get_password(&self, service: &str, entry: &str) -> Option<String> {
            let key = format!("{}:{}", service, entry);
            self.store.lock().unwrap().get(&key).cloned()
        }

        fn delete(&self, service: &str, entry: &str) -> bool {
            let key = format!("{}:{}", service, entry);
            self.store.lock().unwrap().remove(&key).is_some()
        }
    }

    fn mock_store(kc: &MockKeychain, keys: &Keys) {
        let hex = keys.secret_key().to_secret_hex();
        kc.set_password(KEYRING_SERVICE, KEYRING_NSEC, &hex);
    }

    fn mock_load(kc: &MockKeychain) -> Option<Keys> {
        let hex = kc.get_password(KEYRING_SERVICE, KEYRING_NSEC)?;
        let sk = SecretKey::parse(&hex).ok()?;
        Some(Keys::new(sk))
    }

    #[test]
    fn keychain_store_load_roundtrip() {
        let kc = MockKeychain::new();
        let keys = Keys::generate();

        mock_store(&kc, &keys);
        let loaded = mock_load(&kc);

        assert!(loaded.is_some(), "Should load stored key");
        assert_eq!(
            keys.public_key().to_hex(),
            loaded.unwrap().public_key().to_hex(),
            "Loaded key should match stored key"
        );
    }

    #[test]
    fn keychain_load_returns_none_when_empty() {
        let kc = MockKeychain::new();
        let loaded = mock_load(&kc);
        assert!(loaded.is_none(), "Should return None when no key stored");
    }

    #[test]
    fn keychain_delete_is_idempotent() {
        let kc = MockKeychain::new();

        // Delete when nothing is there — should not panic
        let removed = kc.delete(KEYRING_SERVICE, KEYRING_NSEC);
        assert!(!removed, "Should return false when nothing to delete");

        // Delete again — still fine
        let removed = kc.delete(KEYRING_SERVICE, KEYRING_NSEC);
        assert!(!removed);
    }

    #[test]
    fn keychain_overwrite_replaces_key() {
        let kc = MockKeychain::new();
        let keys1 = Keys::generate();
        let keys2 = Keys::generate();

        mock_store(&kc, &keys1);
        mock_store(&kc, &keys2);

        let loaded = mock_load(&kc).unwrap();
        assert_eq!(
            keys2.public_key().to_hex(),
            loaded.public_key().to_hex(),
            "Second store should overwrite first"
        );
    }

    #[test]
    fn keychain_store_uses_hex_format() {
        let kc = MockKeychain::new();
        let keys = Keys::generate();
        mock_store(&kc, &keys);

        let raw = kc.get_password(KEYRING_SERVICE, KEYRING_NSEC).unwrap();
        assert_eq!(raw.len(), 64, "Stored value should be 64-char hex");
        assert!(raw.chars().all(|c| c.is_ascii_hexdigit()), "Should be valid hex");
    }

    #[test]
    fn keychain_delete_removes_key() {
        let kc = MockKeychain::new();
        let keys = Keys::generate();
        mock_store(&kc, &keys);

        assert!(mock_load(&kc).is_some(), "Key should exist after store");
        kc.delete(KEYRING_SERVICE, KEYRING_NSEC);
        assert!(mock_load(&kc).is_none(), "Key should be gone after delete");
    }
}
