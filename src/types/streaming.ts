// Streaming and payment types shared across hooks and components

export interface CreditsInfo {
  remaining_sats: number;
  total_granted: number;
  is_active: boolean;
  can_stream: boolean;
}

export interface StreamSession {
  track_id: string;
  artist_pubkey: string;
  artist_direct: boolean;
  is_playing: boolean;
  intervals_paid: number;
  total_artist_sats: number;
  total_listener_sats: number;
}

export interface IntervalResult {
  session: StreamSession;
  artist_sats: number;
  listener_sats: number;
  credits_remaining: number;
  credits_depleted: boolean;
}

export interface CatalogItem {
  eventId: string;
  artistPubkey: string;
  artistNpub: string;
  artistName: string | null;
  artistPicture: string | null;
  title: string;
  slug: string;
  durationSecs: number | null;
  audioHash: string | null;
  audioUrl: string | null;
  fallbackUrl: string | null;
  mimeType: string | null;
  fileSize: number | null;
  previewSecs: number | null;
  lightningNodeId: string | null;
  imageUrl: string | null;
  createdAt: number;
}

// Product listing (kind 30402) as returned by products_fetch — Rust ProductInfo
export interface ProductInfo {
  event_id: string;
  artist_pubkey: string;
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
  price_sats: number;
  floor_sats: number | null;
  product_type: string;
  format: string | null;
  image_url: string | null;
  track_refs: string[];
  endpoint: string;
  status: string;
  created_at: number;
}

// A completed purchase — Rust PurchaseRecord
export interface PurchaseRecord {
  slug: string;
  title: string;
  artist_pubkey: string;
  endpoint: string;
  amount_sats: number;
  payment_hash: string;
  preimage: string;
  claim_token: string | null;
  format: string | null;
  file_path: string;
  purchased_at: number;
}

export interface IdentityInfo {
  npub: string;
  pubkey_hex: string;
  has_nsec: boolean;
  display_name: string | null;
}
