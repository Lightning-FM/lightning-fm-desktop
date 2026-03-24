// Library feature types

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
  audioUrl: string | null;
  lightningNodeId: string | null;
  artistDirect: boolean;
}

export interface ArtistGroup {
  name: string;
  tracks: LibraryTrack[];
  artworkDataUrl: string | null; // first track's artwork
  trackCount: number;
}

export type LibraryView = "tracks" | "artists";
export type SortField = "title" | "artist" | "album" | "duration";
export type SortDirection = "asc" | "desc";
