// Right pane — artwork, audio file info, and upload stage indicator

import { useRef } from "react";
import type { UploadTrack } from "./types";
import { UploadStageIndicator } from "./UploadStageIndicator";

interface PreviewPaneProps {
  track: UploadTrack;
  albumArtworkDataUrl: string | null;
  onArtworkSelected: (file: File) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatAudioSpec(track: UploadTrack): string {
  const parts = [track.format.toUpperCase()];
  if (track.bitDepth) parts.push(`${track.bitDepth}-bit`);
  if (track.sampleRate) parts.push(`${(track.sampleRate / 1000).toFixed(1)}kHz`);
  return parts.join(" / ");
}

export function PreviewPane({
  track,
  albumArtworkDataUrl,
  onArtworkSelected,
}: PreviewPaneProps) {
  const artworkInputRef = useRef<HTMLInputElement>(null);

  // Use track-specific artwork, fall back to album artwork
  const artworkUrl = track.artworkDataUrl || albumArtworkDataUrl;

  const handleArtworkDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      onArtworkSelected(file);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-3 py-2 border-b border-border">
        <span className="font-label-mono text-muted-foreground uppercase tracking-wider">
          Preview
        </span>
      </div>

      <div className="flex-1 p-3 flex flex-col gap-4 overflow-y-auto">
        {/* Artwork drop zone */}
        <div
          className={`aspect-square border border-border cursor-pointer flex items-center justify-center overflow-hidden transition-all hover:border-[var(--text-muted)] ${
            artworkUrl ? "" : "bg-[var(--bg-secondary)]"
          }`}
          onClick={() => artworkInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={handleArtworkDrop}
        >
          {artworkUrl ? (
            <img
              src={artworkUrl}
              alt="Album artwork"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="text-center p-4">
              <div className="font-body-mono text-muted-foreground mb-1">
                Drop artwork here
              </div>
              <div className="font-small text-muted-foreground">
                1400×1400 min · JPG or PNG
              </div>
            </div>
          )}
        </div>

        <input
          ref={artworkInputRef}
          type="file"
          accept="image/jpeg,image/png"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onArtworkSelected(file);
          }}
        />

        {/* Audio file info */}
        <div className="flex flex-col gap-1">
          <span className="font-label-mono text-muted-foreground uppercase tracking-wider">
            Audio
          </span>
          <div className="font-small text-foreground tabular-nums">
            {formatDuration(track.duration)}
          </div>
          <div className="font-small text-secondary-foreground">
            {formatAudioSpec(track)}
          </div>
          <div className="font-small text-secondary-foreground tabular-nums">
            {formatFileSize(track.fileSize)}
          </div>

          {/* Quality nudge for lossy formats */}
          {track.format.toLowerCase() === "mp3" && (
            <div className="font-small text-warning mt-1 border border-warning/30 px-2 py-1">
              Lossy format — consider uploading WAV or FLAC for best quality
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-border" />

        {/* Upload stage indicator */}
        <UploadStageIndicator
          stage={track.stage}
          progress={track.progress}
          error={track.error}
        />
      </div>
    </div>
  );
}
