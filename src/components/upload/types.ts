// Upload feature types

export type UploadStage =
  | "queued"
  | "uploading"
  | "processing"
  | "mirroring"
  | "publishing"
  | "live"
  | "error"
  | "draft";

export interface UploadTrack {
  /** Client-generated ID for tracking before publish */
  id: string;
  /** Absolute path to the audio file on disk */
  filePath: string;
  /** Original filename */
  fileName: string;

  // Metadata (auto-populated from ID3, editable by artist)
  title: string;
  artist: string;
  album: string;
  trackNumber: number;
  genre: string;
  tags: string[];
  year: string;
  lyrics: string;
  credits: string;
  description: string;
  isExplicit: boolean;
  isrc: string;

  // Audio info (read from file)
  duration: number; // seconds
  format: string; // "WAV", "FLAC", "MP3", etc.
  bitDepth: number | null; // 16, 24, null for lossy
  sampleRate: number | null; // 44100, 48000, 96000, etc.
  fileSize: number; // bytes

  // Artwork
  artworkPath: string | null; // path to artwork file
  artworkDataUrl: string | null; // base64 preview
  embeddedArtwork: boolean; // was artwork extracted from ID3?

  // Waveform (generated during processing)
  waveform: number[] | null; // normalized peaks 0-1

  // Upload state
  stage: UploadStage;
  progress: number; // 0-100 for uploading stage
  error: string | null;

  // Post-publish
  sha256: string | null;
  audioUrl: string | null;
  eventId: string | null;
  artistNpub: string | null;
  relayPublished: boolean;
}

export interface UploadState {
  tracks: UploadTrack[];
  selectedTrackIds: string[];
  albumArtworkPath: string | null;
  albumArtworkDataUrl: string | null;
  albumName: string;
  isDraggingOver: boolean;
}

export type UploadAction =
  | { type: "ADD_FILES"; tracks: UploadTrack[] }
  | { type: "SELECT_TRACK"; id: string }
  | { type: "SELECT_TRACKS"; ids: string[] }
  | { type: "SELECT_ALL" }
  | { type: "DESELECT_ALL" }
  | { type: "UPDATE_TRACK"; id: string; updates: Partial<UploadTrack> }
  | { type: "UPDATE_SELECTED"; updates: Partial<UploadTrack> }
  | { type: "REORDER_TRACKS"; fromIndex: number; toIndex: number }
  | { type: "REMOVE_TRACK"; id: string }
  | { type: "SET_ALBUM_ARTWORK"; path: string | null; dataUrl: string | null }
  | { type: "SET_ALBUM_NAME"; name: string }
  | { type: "SET_DRAGGING"; isDragging: boolean }
  | { type: "SET_STAGE"; id: string; stage: UploadStage; progress?: number; error?: string }
  | { type: "MARK_PUBLISHED"; id: string; sha256: string; audioUrl: string; eventId: string; artistNpub: string }
  | { type: "CLEAR_PUBLISHED" };
