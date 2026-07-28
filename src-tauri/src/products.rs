// Lightning FM — product listings (kind 30402, NIP-99 classifieds + LFM extensions)
//
// A product is a purchasable artifact (lossless track/album download; stems
// later) published as an addressable event by the artist's key. The free
// streaming copy lives in kind 31337 track events; products reference those
// tracks via standard `a` tags and point buyers at the artist's always-on
// seller endpoint (artist-nodes daemon), which handles invoice + delivery.
// The platform never sits in the payment path.
//
// Tag schema (NIP-99 standard):
//   d         — product slug (addressable identifier)
//   title     — product title
//   summary   — short description (long form goes in event content, markdown)
//   price     — ["price", "<sats>", "sats"]
//   image     — cover art URL
//   status    — "active" | "inactive" (unpublish = republish as inactive;
//               addressable events replace on same d tag)
//   t         — category hashtags ("music", plus product type)
// LFM extensions:
//   a         — ["a", "31337:<pubkey>:<track-slug>"] one per included track
//   product_type — "track" | "album"
//   format    — delivered file format ("flac", "wav", "alac", ...)
//   floor     — name-your-price minimum in sats; presence marks the listing
//               as pay-what-you-want (price becomes the suggested amount)
//   endpoint  — base URL of the artist's seller daemon

use nostr_sdk::prelude::*;
use serde::{Deserialize, Serialize};

pub const KIND_PRODUCT: u16 = 30402;

/// Product listing data, both for publishing and as parsed from relays.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProductInfo {
    pub event_id: String,
    pub artist_pubkey: String,
    pub slug: String,
    pub title: String,
    pub summary: Option<String>,
    pub description: Option<String>,
    pub price_sats: u64,
    /// Some(_) marks the listing as name-your-price with this minimum.
    pub floor_sats: Option<u64>,
    pub product_type: String,
    pub format: Option<String>,
    pub image_url: Option<String>,
    /// Addressable coordinates of included tracks ("31337:<pubkey>:<slug>").
    pub track_refs: Vec<String>,
    pub endpoint: String,
    pub status: String,
    pub created_at: u64,
}

/// Input for publishing — everything author-side except identity/event fields.
#[derive(Clone, Debug, Deserialize)]
pub struct ProductDraft {
    pub slug: String,
    pub title: String,
    pub summary: Option<String>,
    pub description: Option<String>,
    pub price_sats: u64,
    pub floor_sats: Option<u64>,
    pub product_type: String,
    pub format: Option<String>,
    pub image_url: Option<String>,
    pub track_refs: Vec<String>,
    pub endpoint: String,
}

/// Validate a draft before it goes anywhere near a relay.
pub fn validate_draft(draft: &ProductDraft) -> Result<(), String> {
    if draft.slug.trim().is_empty() {
        return Err("Product slug is required".into());
    }
    if draft.title.trim().is_empty() {
        return Err("Product title is required".into());
    }
    if !matches!(draft.product_type.as_str(), "track" | "album") {
        return Err(format!("Unknown product type: {}", draft.product_type));
    }
    if draft.track_refs.is_empty() {
        return Err("A product must reference at least one track".into());
    }
    if draft.product_type == "track" && draft.track_refs.len() != 1 {
        return Err("A track product must reference exactly one track".into());
    }
    for r in &draft.track_refs {
        let parts: Vec<&str> = r.splitn(3, ':').collect();
        if parts.len() != 3 || parts[0] != "31337" || parts[1].len() != 64 || parts[2].is_empty() {
            return Err(format!("Invalid track reference: {}", r));
        }
    }
    if draft.price_sats == 0 && draft.floor_sats.is_none() {
        return Err("Price must be > 0 (or set a name-your-price floor)".into());
    }
    if let Some(floor) = draft.floor_sats {
        if floor > draft.price_sats && draft.price_sats > 0 {
            return Err("Floor cannot exceed the suggested price".into());
        }
    }
    let endpoint = draft.endpoint.trim();
    if !(endpoint.starts_with("https://") || endpoint.starts_with("http://")) {
        return Err("Seller endpoint must be an http(s) URL".into());
    }
    Ok(())
}

/// Build the tag set for a kind 30402 product event. Pure — testable.
pub fn build_product_tags(draft: &ProductDraft, status: &str) -> Vec<Tag> {
    let mut tags = vec![
        Tag::custom(TagKind::custom("d"), vec![draft.slug.clone()]),
        Tag::custom(TagKind::custom("title"), vec![draft.title.clone()]),
        Tag::custom(
            TagKind::custom("price"),
            vec![draft.price_sats.to_string(), "sats".to_string()],
        ),
        Tag::custom(TagKind::custom("status"), vec![status.to_string()]),
        Tag::custom(TagKind::custom("t"), vec!["music".to_string()]),
        Tag::custom(TagKind::custom("t"), vec![draft.product_type.clone()]),
        Tag::custom(TagKind::custom("product_type"), vec![draft.product_type.clone()]),
        Tag::custom(TagKind::custom("endpoint"), vec![draft.endpoint.trim().to_string()]),
    ];

    for track_ref in &draft.track_refs {
        tags.push(Tag::custom(TagKind::custom("a"), vec![track_ref.clone()]));
    }
    if let Some(ref summary) = draft.summary {
        tags.push(Tag::custom(TagKind::custom("summary"), vec![summary.clone()]));
    }
    if let Some(floor) = draft.floor_sats {
        tags.push(Tag::custom(TagKind::custom("floor"), vec![floor.to_string()]));
    }
    if let Some(ref format) = draft.format {
        tags.push(Tag::custom(TagKind::custom("format"), vec![format.clone()]));
    }
    if let Some(ref image) = draft.image_url {
        tags.push(Tag::custom(TagKind::custom("image"), vec![image.clone()]));
    }

    tags
}

/// Publish (or replace — same d tag) a product listing. Returns the event id.
pub async fn publish_product(
    client: &Client,
    draft: &ProductDraft,
    status: &str,
) -> Result<String, String> {
    validate_draft(draft)?;

    let content = draft.description.clone().unwrap_or_default();
    let builder = EventBuilder::new(Kind::Custom(KIND_PRODUCT), content)
        .tags(build_product_tags(draft, status));

    let output = client
        .send_event_builder(builder)
        .await
        .map_err(|e| format!("Failed to publish product: {}", e))?;

    let event_id = output.id().to_hex();
    log::info!(
        "Published product '{}' ({}) as event {} [{}]",
        draft.title, draft.slug, event_id, status
    );
    Ok(event_id)
}

/// Fetch active product listings for a set of artists (buyer-side browse).
pub async fn fetch_products_for_authors(
    client: &Client,
    authors: Vec<PublicKey>,
) -> Result<Vec<ProductInfo>, String> {
    if authors.is_empty() {
        return Ok(Vec::new());
    }
    let filter = Filter::new()
        .kind(Kind::Custom(KIND_PRODUCT))
        .authors(authors)
        .limit(500);

    let events = client
        .fetch_events(filter, std::time::Duration::from_secs(5))
        .await
        .map_err(|e| format!("Failed to fetch products: {e}"))?;

    Ok(events
        .iter()
        .filter_map(parse_product_event)
        .filter(|p| p.status == "active")
        .collect())
}

/// Fetch the signed-in artist's own product listings.
pub async fn fetch_my_products(
    client: &Client,
    pubkey: PublicKey,
) -> Result<Vec<ProductInfo>, String> {
    let filter = Filter::new()
        .kind(Kind::Custom(KIND_PRODUCT))
        .author(pubkey)
        .limit(200);

    let events = client
        .fetch_events(filter, std::time::Duration::from_secs(5))
        .await
        .map_err(|e| format!("Failed to fetch products: {}", e))?;

    let mut products: Vec<ProductInfo> =
        events.iter().filter_map(parse_product_event).collect();
    products.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(products)
}

/// Parse a kind 30402 event into ProductInfo. Returns None for events
/// missing required tags (foreign 30402s that aren't LFM products).
pub fn parse_product_event(event: &Event) -> Option<ProductInfo> {
    let get_tag = |name: &str| -> Option<String> {
        event.tags.iter().find_map(|tag| {
            let values = tag.as_slice();
            if values.len() >= 2 && values[0] == name {
                Some(values[1].to_string())
            } else {
                None
            }
        })
    };

    let track_refs: Vec<String> = event
        .tags
        .iter()
        .filter_map(|tag| {
            let values = tag.as_slice();
            if values.len() >= 2 && values[0] == "a" && values[1].starts_with("31337:") {
                Some(values[1].to_string())
            } else {
                None
            }
        })
        .collect();

    // LFM products require an endpoint and at least one track ref
    let endpoint = get_tag("endpoint")?;
    if track_refs.is_empty() {
        return None;
    }

    let price_sats = event.tags.iter().find_map(|tag| {
        let values = tag.as_slice();
        if values.len() >= 3 && values[0] == "price" && values[2] == "sats" {
            values[1].parse::<u64>().ok()
        } else {
            None
        }
    })?;

    Some(ProductInfo {
        event_id: event.id.to_hex(),
        artist_pubkey: event.pubkey.to_hex(),
        slug: get_tag("d").unwrap_or_default(),
        title: get_tag("title")?,
        summary: get_tag("summary"),
        description: if event.content.is_empty() {
            None
        } else {
            Some(event.content.clone())
        },
        price_sats,
        floor_sats: get_tag("floor").and_then(|f| f.parse().ok()),
        product_type: get_tag("product_type").unwrap_or_else(|| "track".to_string()),
        format: get_tag("format"),
        image_url: get_tag("image"),
        track_refs,
        endpoint,
        status: get_tag("status").unwrap_or_else(|| "active".to_string()),
        created_at: event.created_at.as_u64(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft() -> ProductDraft {
        ProductDraft {
            slug: "midnight-flac".into(),
            title: "Midnight (Lossless)".into(),
            summary: Some("24-bit FLAC master".into()),
            description: Some("Full description here.".into()),
            price_sats: 5000,
            floor_sats: None,
            product_type: "track".into(),
            format: Some("flac".into()),
            image_url: Some("https://media.lightning.fm/abc.jpg".into()),
            track_refs: vec![format!("31337:{}:midnight", "a".repeat(64))],
            endpoint: "https://node.example.com".into(),
        }
    }

    fn tag_value(tags: &[Tag], name: &str) -> Option<String> {
        tags.iter().find_map(|t| {
            let v = t.as_slice();
            (v.len() >= 2 && v[0] == name).then(|| v[1].to_string())
        })
    }

    // ─── validate_draft ─────────────────────────────────────────

    #[test]
    fn valid_draft_passes() {
        assert!(validate_draft(&draft()).is_ok());
    }

    #[test]
    fn empty_title_rejected() {
        let mut d = draft();
        d.title = "  ".into();
        assert!(validate_draft(&d).is_err());
    }

    #[test]
    fn zero_price_without_floor_rejected() {
        let mut d = draft();
        d.price_sats = 0;
        assert!(validate_draft(&d).is_err());
    }

    #[test]
    fn zero_price_with_floor_allowed() {
        let mut d = draft();
        d.price_sats = 0;
        d.floor_sats = Some(0);
        assert!(validate_draft(&d).is_ok(), "pay-what-you-want with 0 floor is valid");
    }

    #[test]
    fn floor_above_price_rejected() {
        let mut d = draft();
        d.floor_sats = Some(9000);
        assert!(validate_draft(&d).is_err());
    }

    #[test]
    fn track_product_with_two_refs_rejected() {
        let mut d = draft();
        d.track_refs.push(format!("31337:{}:other", "b".repeat(64)));
        assert!(validate_draft(&d).is_err());
    }

    #[test]
    fn album_with_multiple_refs_allowed() {
        let mut d = draft();
        d.product_type = "album".into();
        d.track_refs.push(format!("31337:{}:other", "b".repeat(64)));
        assert!(validate_draft(&d).is_ok());
    }

    #[test]
    fn malformed_track_ref_rejected() {
        let mut d = draft();
        d.track_refs = vec!["30023:abc:wrong-kind".into()];
        assert!(validate_draft(&d).is_err());
    }

    #[test]
    fn non_http_endpoint_rejected() {
        let mut d = draft();
        d.endpoint = "ws://node.example.com".into();
        assert!(validate_draft(&d).is_err());
    }

    // ─── build_product_tags ─────────────────────────────────────

    #[test]
    fn tags_include_required_fields() {
        let tags = build_product_tags(&draft(), "active");
        assert_eq!(tag_value(&tags, "d").unwrap(), "midnight-flac");
        assert_eq!(tag_value(&tags, "title").unwrap(), "Midnight (Lossless)");
        assert_eq!(tag_value(&tags, "status").unwrap(), "active");
        assert_eq!(tag_value(&tags, "product_type").unwrap(), "track");
        assert_eq!(tag_value(&tags, "endpoint").unwrap(), "https://node.example.com");
        assert_eq!(tag_value(&tags, "format").unwrap(), "flac");
    }

    #[test]
    fn price_tag_carries_sats_currency() {
        let tags = build_product_tags(&draft(), "active");
        let price = tags
            .iter()
            .find(|t| t.as_slice()[0] == "price")
            .expect("price tag present");
        assert_eq!(price.as_slice()[1], "5000");
        assert_eq!(price.as_slice()[2], "sats");
    }

    #[test]
    fn floor_tag_only_when_set() {
        let tags = build_product_tags(&draft(), "active");
        assert!(tag_value(&tags, "floor").is_none());

        let mut d = draft();
        d.floor_sats = Some(1000);
        let tags = build_product_tags(&d, "active");
        assert_eq!(tag_value(&tags, "floor").unwrap(), "1000");
    }

    // ─── parse round-trip ───────────────────────────────────────

    #[test]
    fn publish_shape_parses_back() {
        let d = draft();
        let keys = Keys::generate();
        let event = EventBuilder::new(Kind::Custom(KIND_PRODUCT), "Full description here.")
            .tags(build_product_tags(&d, "active"))
            .sign_with_keys(&keys)
            .expect("sign");

        let parsed = parse_product_event(&event).expect("parses");
        assert_eq!(parsed.slug, d.slug);
        assert_eq!(parsed.title, d.title);
        assert_eq!(parsed.price_sats, d.price_sats);
        assert_eq!(parsed.product_type, "track");
        assert_eq!(parsed.track_refs, d.track_refs);
        assert_eq!(parsed.endpoint, d.endpoint);
        assert_eq!(parsed.status, "active");
        assert_eq!(parsed.description.as_deref(), Some("Full description here."));
        assert_eq!(parsed.artist_pubkey, keys.public_key().to_hex());
    }

    #[test]
    fn foreign_30402_without_endpoint_ignored() {
        let keys = Keys::generate();
        let event = EventBuilder::new(Kind::Custom(KIND_PRODUCT), "selling a couch")
            .tags(vec![
                Tag::custom(TagKind::custom("d"), vec!["couch".to_string()]),
                Tag::custom(TagKind::custom("title"), vec!["Couch".to_string()]),
                Tag::custom(
                    TagKind::custom("price"),
                    vec!["100".to_string(), "USD".to_string()],
                ),
            ])
            .sign_with_keys(&keys)
            .expect("sign");

        assert!(parse_product_event(&event).is_none());
    }
}
