// Upload view — orchestrates the 3-pane upload experience
// Drop zone (initial) → Track list | Detail | Preview (after files added)

import { useReducer, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { UploadTrack } from "./types";
import { uploadReducer, initialUploadState } from "./reducer";
import { DropZone } from "./DropZone";
import { TrackList } from "./TrackList";
import { TrackDetail } from "./TrackDetail";
import { PreviewPane } from "./PreviewPane";

// Result from upload_track Tauri command
interface TrackInfo {
  event_id: string;
  title: string;
  slug: string;
  audio_url: string;
  sha256: string;
}

let nextId = 1;
function genId(): string {
  return `upload-${nextId++}-${Date.now()}`;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function extensionToFormat(ext: string): string {
  const map: Record<string, string> = {
    wav: "WAV",
    flac: "FLAC",
    aiff: "AIFF",
    aif: "AIFF",
    mp3: "MP3",
    ogg: "OGG",
    m4a: "M4A",
    aac: "AAC",
    opus: "OPUS",
  };
  return map[ext.toLowerCase()] || ext.toUpperCase();
}

export function UploadView() {
  const [state, dispatch] = useReducer(uploadReducer, initialUploadState);

  const selectedTrack = state.tracks.find((t) =>
    state.selectedTrackIds.includes(t.id)
  );

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // ⌘+S — save draft
      if (e.metaKey && e.key === "s") {
        e.preventDefault();
        // TODO: persist draft state to disk
      }
      // ⌘+Enter — publish
      if (e.metaKey && e.key === "Enter") {
        e.preventDefault();
        handlePublish();
      }
      // ⌘+E — batch edit (when multiple selected)
      if (e.metaKey && e.key === "e") {
        e.preventDefault();
        if (state.selectedTrackIds.length > 1) {
          // TODO: open batch edit modal
        }
      }
      // ⌘+A — select all (when in upload view)
      if (e.metaKey && e.key === "a" && state.tracks.length > 0) {
        e.preventDefault();
        dispatch({ type: "SELECT_ALL" });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [state.selectedTrackIds, state.tracks]);

  // Handle files selected via drop or browse
  const handleFilesSelected = useCallback((files: FileList) => {
    const audioFiles = Array.from(files).filter((f) => {
      const ext = f.name.split(".").pop()?.toLowerCase() || "";
      return [
        "wav",
        "flac",
        "aiff",
        "aif",
        "mp3",
        "ogg",
        "m4a",
        "aac",
        "opus",
      ].includes(ext);
    });

    if (audioFiles.length === 0) return;

    const newTracks: UploadTrack[] = audioFiles.map((file, index) => {
      const ext = file.name.split(".").pop() || "";
      const nameWithoutExt = file.name.replace(/\.[^.]+$/, "");

      return {
        id: genId(),
        // webkitRelativePath gives the full path for folder drops
        filePath: (file as any).path || file.name,
        fileName: file.name,

        // Defaults — will be overwritten by ID3 tag reading
        title: nameWithoutExt,
        artist: "",
        album: "",
        trackNumber: index + 1,
        genre: "",
        tags: [],
        year: "",
        lyrics: "",
        credits: "",
        description: "",
        isExplicit: false,
        isrc: "",

        // Audio info from File API (approximate — Rust will give exact values)
        duration: 0,
        format: extensionToFormat(ext),
        bitDepth: null,
        sampleRate: null,
        fileSize: file.size,

        // Artwork
        artworkPath: null,
        artworkDataUrl: null,
        embeddedArtwork: false,

        // Waveform
        waveform: null,

        // State
        stage: "draft",
        progress: 0,
        error: null,

        // Post-publish
        sha256: null,
        audioUrl: null,
        eventId: null,
      };
    });

    dispatch({ type: "ADD_FILES", tracks: newTracks });

    // For each file, read metadata + artwork + waveform in parallel via Rust
    for (const track of newTracks) {
      enrichTrack(track.id, track.filePath);
    }
  }, []);

  // Read ID3/Vorbis tags, extract artwork, generate waveform for a track
  async function enrichTrack(trackId: string, filePath: string) {
    // 1. Read metadata (tags + audio properties)
    try {
      const meta = await invoke<{
        title: string | null;
        artist: string | null;
        album: string | null;
        track_number: number | null;
        genre: string | null;
        year: string | null;
        lyrics: string | null;
        has_artwork: boolean;
        duration_secs: number;
        sample_rate: number | null;
        bit_depth: number | null;
        channels: number | null;
        format: string;
      }>("metadata_read", { filePath });

      dispatch({
        type: "UPDATE_TRACK",
        id: trackId,
        updates: {
          title: meta.title || undefined,
          artist: meta.artist || undefined,
          album: meta.album || undefined,
          trackNumber: meta.track_number || undefined,
          genre: meta.genre || undefined,
          year: meta.year || undefined,
          lyrics: meta.lyrics || undefined,
          duration: meta.duration_secs,
          sampleRate: meta.sample_rate,
          bitDepth: meta.bit_depth,
          format: meta.format,
        } as Partial<UploadTrack>,
      });
    } catch (e) {
      console.warn(`Failed to read metadata for ${filePath}:`, e);
    }

    // 2. Extract embedded artwork
    try {
      const artwork = await invoke<{
        data_url: string;
        mime_type: string;
      } | null>("artwork_extract", { filePath });

      if (artwork) {
        dispatch({
          type: "UPDATE_TRACK",
          id: trackId,
          updates: {
            artworkDataUrl: artwork.data_url,
            embeddedArtwork: true,
          },
        });
        // Use first track's artwork as album artwork if none set
        // (checked inside dispatch won't work, so we set it directly)
        dispatch({
          type: "SET_ALBUM_ARTWORK",
          path: null,
          dataUrl: artwork.data_url,
        });
      }
    } catch (e) {
      console.warn(`Failed to extract artwork for ${filePath}:`, e);
    }

    // 3. Generate waveform peaks
    try {
      const waveform = await invoke<{
        peaks: number[];
        duration_secs: number;
      }>("waveform_generate", { filePath });

      dispatch({
        type: "UPDATE_TRACK",
        id: trackId,
        updates: {
          waveform: waveform.peaks,
          duration: waveform.duration_secs,
        },
      });
    } catch (e) {
      console.warn(`Failed to generate waveform for ${filePath}:`, e);
    }
  }

  // Handle artwork selected for album/selected track
  const handleArtworkSelected = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        dispatch({
          type: "SET_ALBUM_ARTWORK",
          path: (file as any).path || file.name,
          dataUrl,
        });
      };
      reader.readAsDataURL(file);
    },
    []
  );

  // Publish all draft tracks
  async function handlePublish() {
    const drafts = state.tracks.filter(
      (t) => t.stage === "draft" || t.stage === "error"
    );
    if (drafts.length === 0) return;

    for (const track of drafts) {
      // Validate required fields
      if (!track.title.trim()) {
        dispatch({
          type: "SET_STAGE",
          id: track.id,
          stage: "error",
          error: "Title is required",
        });
        continue;
      }

      try {
        // Stage 0: Write metadata back to file before hashing
        dispatch({
          type: "SET_STAGE",
          id: track.id,
          stage: "processing",
          progress: 0,
        });

        await invoke("metadata_write", {
          filePath: track.filePath,
          title: track.title || null,
          artist: track.artist || null,
          album: track.album || null,
          trackNumber: track.trackNumber || null,
          genre: track.genre || null,
          year: track.year || null,
          lyrics: track.lyrics || null,
        });

        // Stage 1: Uploading
        dispatch({
          type: "SET_STAGE",
          id: track.id,
          stage: "uploading",
          progress: 0,
        });

        // Simulate progress ticks (actual progress will come from Tauri events)
        const progressInterval = setInterval(() => {
          dispatch({
            type: "SET_STAGE",
            id: track.id,
            stage: "uploading",
            progress: Math.min(
              90,
              (state.tracks.find((t) => t.id === track.id)?.progress ?? 0) + 15
            ),
          });
        }, 500);

        // Stage 2-4 happen inside upload_track
        dispatch({
          type: "SET_STAGE",
          id: track.id,
          stage: "uploading",
          progress: 50,
        });

        const result = await invoke<TrackInfo>("upload_track", {
          filePath: track.filePath,
          title: track.title,
          slug: slugify(track.title),
          durationSecs: track.duration > 0 ? Math.round(track.duration) : undefined,
        });

        clearInterval(progressInterval);

        // Stage 5: Live
        dispatch({
          type: "MARK_PUBLISHED",
          id: track.id,
          sha256: result.sha256,
          audioUrl: result.audio_url,
          eventId: result.event_id,
        });
      } catch (err) {
        dispatch({
          type: "SET_STAGE",
          id: track.id,
          stage: "error",
          error: String(err),
        });
      }
    }
  }

  // Count by stage for the footer
  const stageCounts = state.tracks.reduce(
    (acc, t) => {
      acc[t.stage] = (acc[t.stage] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const uploading =
    (stageCounts["uploading"] || 0) +
    (stageCounts["processing"] || 0) +
    (stageCounts["mirroring"] || 0) +
    (stageCounts["publishing"] || 0);
  const drafts = stageCounts["draft"] || 0;
  const live = stageCounts["live"] || 0;
  const errors = stageCounts["error"] || 0;

  // Show drop zone if no tracks yet
  if (state.tracks.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="shrink-0 h-8 flex items-center px-4 border-b border-border">
          <span className="font-label-mono text-amber uppercase tracking-wider">
            Upload
          </span>
          <span className="font-small text-muted-foreground ml-4">
            <span className="border border-border px-1">⌘U</span>
          </span>
        </div>

        <DropZone
          isDraggingOver={state.isDraggingOver}
          onDragOver={() => dispatch({ type: "SET_DRAGGING", isDragging: true })}
          onDragLeave={() =>
            dispatch({ type: "SET_DRAGGING", isDragging: false })
          }
          onFilesSelected={handleFilesSelected}
        />
      </div>
    );
  }

  // 3-pane layout after files are added
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 h-8 flex items-center px-4 border-b border-border">
        <span className="font-label-mono text-amber uppercase tracking-wider">
          Upload
        </span>
        <span className="font-small text-muted-foreground ml-4">
          {state.albumName && (
            <span className="text-secondary-foreground mr-3">
              {state.albumName}
            </span>
          )}
          {state.tracks.length} track{state.tracks.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* 3-pane content */}
      <div className="flex flex-1 min-h-0">
        {/* Left: Track list */}
        <div className="shrink-0 w-56 border-r border-border">
          <TrackList
            tracks={state.tracks}
            selectedTrackIds={state.selectedTrackIds}
            onSelectTrack={(id) => dispatch({ type: "SELECT_TRACK", id })}
            onSelectAll={() => dispatch({ type: "SELECT_ALL" })}
            onReorder={(from, to) =>
              dispatch({ type: "REORDER_TRACKS", fromIndex: from, toIndex: to })
            }
            onRemoveTrack={(id) => dispatch({ type: "REMOVE_TRACK", id })}
          />
        </div>

        {/* Center: Track detail */}
        <div className="flex-1 min-w-0 border-r border-border">
          {selectedTrack ? (
            <TrackDetail
              track={selectedTrack}
              onUpdate={(updates) =>
                dispatch({
                  type: "UPDATE_TRACK",
                  id: selectedTrack.id,
                  updates,
                })
              }
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <span className="font-body-mono text-muted-foreground">
                Select a track to edit
              </span>
            </div>
          )}
        </div>

        {/* Right: Preview */}
        <div className="shrink-0 w-56">
          {selectedTrack ? (
            <PreviewPane
              track={selectedTrack}
              albumArtworkDataUrl={state.albumArtworkDataUrl}
              onArtworkSelected={handleArtworkSelected}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <span className="font-body-mono text-muted-foreground">
                No track selected
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Footer — status bar + actions */}
      <div className="shrink-0 h-10 flex items-center px-4 border-t border-border gap-4">
        {/* Status summary */}
        <span className="font-small text-secondary-foreground">
          {state.tracks.length} track{state.tracks.length !== 1 ? "s" : ""}
          {uploading > 0 && (
            <span className="text-amber ml-2">
              · {uploading} uploading
            </span>
          )}
          {drafts > 0 && (
            <span className="text-muted-foreground ml-2">
              · {drafts} draft{drafts !== 1 ? "s" : ""}
            </span>
          )}
          {live > 0 && (
            <span className="text-[var(--success)] ml-2">
              · {live} live
            </span>
          )}
          {errors > 0 && (
            <span className="text-error ml-2">
              · {errors} error{errors !== 1 ? "s" : ""}
            </span>
          )}
        </span>

        <div className="flex-1" />

        {/* Add more files */}
        <button
          className="h-7 px-3 border border-border text-secondary-foreground font-label-mono uppercase tracking-wider hover:border-[var(--text-muted)] hover:text-foreground transition-all text-[11px]"
          onClick={() => {
            // Reset to show drop zone overlay
            // For now, trigger file input
            const input = document.createElement("input");
            input.type = "file";
            input.multiple = true;
            input.accept =
              "audio/wav,audio/flac,audio/aiff,audio/mpeg,audio/ogg,audio/mp4,audio/aac,audio/opus";
            input.onchange = () => {
              if (input.files) handleFilesSelected(input.files);
            };
            input.click();
          }}
        >
          + Add Files
        </button>

        {/* Save draft */}
        <button
          className="h-7 px-3 border border-border text-secondary-foreground font-label-mono uppercase tracking-wider hover:border-[var(--text-muted)] hover:text-foreground transition-all text-[11px]"
          onClick={() => {
            // TODO: persist state to disk
          }}
        >
          Save Draft
        </button>

        {/* Publish */}
        <button
          className="h-7 px-4 border border-amber text-amber font-label-mono uppercase tracking-wider hover:bg-amber/10 transition-all text-[11px]"
          onClick={handlePublish}
          disabled={drafts === 0}
        >
          Publish{drafts > 0 ? ` (${drafts})` : ""}
        </button>
      </div>
    </div>
  );
}
