// Library feature types

import type { ProductInfo } from "../../types/streaming";

export interface LibraryTrack {
  title: string;
  artist: string;
  album: string;
  hash: string;
  cachePath: string;
  duration: number; // seconds
  format: string;
  artworkDataUrl: string | null;
  // Nostr event data (null for local test tracks)
  eventId: string | null;
  artistPubkey: string | null;
  slug: string | null;
  audioUrl: string | null;
  lightningNodeId: string | null;
  artistDirect: boolean;
  /** Purchasable download listing for this track, when the artist sells one */
  product: ProductInfo | null;
}

export interface ArtistGroup {
  name: string;
  tracks: LibraryTrack[];
  artworkDataUrl: string | null; // first track's artwork
  trackCount: number;
}

export type LibraryView = "tracks" | "artists" | "purchases";
export type SortField = "title" | "artist" | "album" | "duration";
export type SortDirection = "asc" | "desc";
