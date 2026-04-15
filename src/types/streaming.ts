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
  total_platform_sats: number;
  total_listener_sats: number;
}

export interface IntervalResult {
  session: StreamSession;
  artist_sats: number;
  platform_sats: number;
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

export interface IdentityInfo {
  npub: string;
  pubkey_hex: string;
  has_nsec: boolean;
  display_name: string | null;
}
