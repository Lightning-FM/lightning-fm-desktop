// Library feature types

import type { ProductInfo } from "../../types/streaming";

export interface LibraryTrack {
  title: string;
  artist: string;
  /** Artist's kind-0 about text, when published */
  artistAbout: string | null;
  album: string;
  hash: string;
  cachePath: string;
  duration: number; // seconds
  format: string;
  fileSize: number | null; // bytes, when the event declares it
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
  /** The artist's description of the track (kind 31337 event content) */
  description: string | null;
  /** Music video URL, when the track publishes one */
  videoUrl: string | null;
}

export interface ArtistGroup {
  name: string;
  about: string | null; // artist's kind-0 about text
  tracks: LibraryTrack[];
  artworkDataUrl: string | null; // first track's artwork
  trackCount: number;
}

export type LibraryView = "tracks" | "artists" | "purchases";
export type SortField = "title" | "artist" | "album" | "duration";
export type SortDirection = "asc" | "desc";
