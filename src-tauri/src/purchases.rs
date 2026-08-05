// Lightning FM — buyer-side purchases.
//
// The desktop buyer's advantage over the web: the embedded node pays the
// invoice directly, so we hold the preimage — the durable, cryptographic
// re-download credential — the moment payment settles. Purchases persist to
// ~/.lightning-fm/purchases.json; artifacts land in ~/.lightning-fm/purchases/.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PurchaseRecord {
    pub slug: String,
    pub title: String,
    pub artist_pubkey: String,
    /// Hex pubkey of the identity that bought it. Purchases are private to
    /// the buyer; records without one (pre-field legacy) are shown to no one.
    #[serde(default)]
    pub buyer_pubkey: String,
    pub endpoint: String,
    pub amount_sats: u64,
    pub payment_hash: String,
    /// Hex preimage — proof of payment and re-download credential.
    pub preimage: String,
    pub claim_token: Option<String>,
    pub format: Option<String>,
    /// Absolute path of the downloaded artifact.
    pub file_path: String,
    pub purchased_at: u64,
}

pub struct PurchasesState {
    pub records: Mutex<Vec<PurchaseRecord>>,
}

fn purchases_file() -> PathBuf {
    let home = dirs::home_dir().expect("Could not determine home directory");
    home.join(".lightning-fm").join("purchases.json")
}

pub fn purchases_dir() -> PathBuf {
    let home = dirs::home_dir().expect("Could not determine home directory");
    home.join(".lightning-fm").join("purchases")
}

impl PurchasesState {
    pub fn new() -> Self {
        let records = std::fs::read_to_string(purchases_file())
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        Self {
            records: Mutex::new(records),
        }
    }
}

/// Append a purchase and persist. Returns an error string on IO failure —
/// the purchase itself already succeeded at that point, so callers should
/// surface but not fail the flow.
pub fn record_purchase(state: &PurchasesState, record: PurchaseRecord) -> Result<(), String> {
    let mut records = state.records.lock().map_err(|_| "Purchases lock poisoned")?;
    records.push(record);
    let raw = serde_json::to_string_pretty(&*records)
        .map_err(|e| format!("Failed to serialize purchases: {e}"))?;
    let path = purchases_file();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {e}"))?;
    }
    std::fs::write(&path, raw).map_err(|e| format!("Failed to write purchases: {e}"))?;
    Ok(())
}

/// List the given buyer's purchases, newest first. The store is shared
/// across identities on this machine, so filtering here is what keeps one
/// signer's purchase history invisible to the next.
pub fn list_purchases(
    state: &PurchasesState,
    buyer_pubkey: &str,
) -> Result<Vec<PurchaseRecord>, String> {
    let records = state.records.lock().map_err(|_| "Purchases lock poisoned")?;
    let mut out: Vec<PurchaseRecord> = records
        .iter()
        .filter(|r| !buyer_pubkey.is_empty() && r.buyer_pubkey == buyer_pubkey)
        .cloned()
        .collect();
    out.sort_by(|a, b| b.purchased_at.cmp(&a.purchased_at));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(slug: &str, at: u64) -> PurchaseRecord {
        PurchaseRecord {
            slug: slug.into(),
            title: "T".into(),
            artist_pubkey: "a".repeat(64),
            buyer_pubkey: "d".repeat(64),
            endpoint: "http://localhost:18190".into(),
            amount_sats: 2500,
            payment_hash: "b".repeat(64),
            preimage: "c".repeat(64),
            claim_token: None,
            format: Some("flac".into()),
            file_path: "/tmp/x.flac".into(),
            purchased_at: at,
        }
    }

    #[test]
    fn list_is_newest_first() {
        let state = PurchasesState {
            records: Mutex::new(vec![record("old", 100), record("new", 200)]),
        };
        let list = list_purchases(&state, &"d".repeat(64)).unwrap();
        assert_eq!(list[0].slug, "new");
        assert_eq!(list[1].slug, "old");
    }

    #[test]
    fn list_only_shows_the_buyers_own_purchases() {
        let mut other = record("theirs", 300);
        other.buyer_pubkey = "e".repeat(64);
        let mut legacy = record("legacy", 50);
        legacy.buyer_pubkey = String::new(); // pre-field record — attributable to no one
        let state = PurchasesState {
            records: Mutex::new(vec![record("mine", 100), other, legacy]),
        };
        let list = list_purchases(&state, &"d".repeat(64)).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].slug, "mine");
        assert!(list_purchases(&state, "").unwrap().is_empty());
    }
}
